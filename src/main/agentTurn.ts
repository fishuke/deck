import { type Agent } from "../shared/agents.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { markInternalSession } from "./sessions.js";
import { resolveCommand } from "./userShell.js";

// One headless turn of a coding agent, driven by deck itself: the "Ask deck"
// orchestrator and the PR review assistant both run through here. Built-in
// tools stay read-only; acting happens through deck's own MCP tools, which
// the user can see and audit in the conversation.

const TURN_TIMEOUT_MS = 600_000;
const READ_ONLY_TOOLS = "Read,Grep,Glob";

export interface AskResult {
  ok: boolean;
  text: string;
  error?: string;
}

/** What the conversation shows while a turn runs: answer text, or a tool the assistant is using. */
export type AskEvent = { type: "text"; text: string } | { type: "tool"; name: string; input: string };

export type OnEvent = (event: AskEvent) => void;

/** What deck remembers between turns of one conversation. */
export interface Conversation {
  /** The claude session deck resumes each turn; unset until the first turn. */
  conversationId?: string;
  /** Codex has no resumable session, so its exchanges are replayed. */
  codexHistory: string[];
}

export const newConversation = (): Conversation => ({ codexHistory: [] });

export interface TurnOptions {
  agent: Agent;
  model: string;
  systemPrompt: string;
  /** Fresh context for this turn, prepended to the question. */
  context: string;
  question: string;
  /** Where the agent runs; its read-only tools see this directory. */
  cwd: string;
  mcp: { name: string; url: string; tools: string[] };
  conversation: Conversation;
  onEvent: OnEvent;
}

export interface TurnOutcome {
  result: AskResult;
  conversation: Conversation;
}


/** Runs one turn and returns the conversation state to keep for the next. */
export function runTurn(options: TurnOptions): Promise<TurnOutcome> {
  return options.agent === "codex" ? codexTurn(options) : claudeTurn(options);
}

function claudeTurn({ model, systemPrompt, context, question, cwd, mcp, conversation, onEvent }: TurnOptions): Promise<TurnOutcome> {
  const args = [
    "-p",
    `${context}\n\n${question}`,
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--append-system-prompt",
    systemPrompt,
    "--tools",
    READ_ONLY_TOOLS,
    "--allowedTools",
    [READ_ONLY_TOOLS, ...mcp.tools.map((tool) => `mcp__${mcp.name}__${tool}`)].join(","),
    "--mcp-config",
    JSON.stringify({ mcpServers: { [mcp.name]: { type: "http", url: mcp.url } } }),
    "--strict-mcp-config",
  ];
  const conversationId = conversation.conversationId ?? randomUUID();
  args.push(conversation.conversationId ? "--resume" : "--session-id", conversationId);
  // deck's own turns fire the same hooks as any session; without this they
  // would show up in the very list they are describing.
  markInternalSession(conversationId);
  return run(args, onEvent, "claude", cwd, mcp.name).then((result) => ({ result, conversation: { ...conversation, conversationId } }));
}

async function codexTurn({ systemPrompt, context, question, cwd, mcp, conversation, onEvent }: TurnOptions): Promise<TurnOutcome> {
  const prompt = `${systemPrompt}\n\n${conversation.codexHistory.join("\n\n")}\n\n${context}\n\nuser: ${question}`;
  const result = await run(["exec", "--json", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only",
    "--config", 'approval_policy="never"', "--config", "features.hooks=false",
    "--config", `mcp_servers.${mcp.name}.url="${mcp.url}"`, "--skip-git-repo-check", "--", prompt], onEvent, "codex", cwd, mcp.name);
  const codexHistory = result.ok
    ? [...conversation.codexHistory, `user: ${question}`, `assistant: ${result.text}`].slice(-20)
    : conversation.codexHistory;
  return { result, conversation: { ...conversation, codexHistory } };
}

interface StreamLine {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  item?: { type?: string; text?: string; tool?: string; server?: string; arguments?: unknown };
  error?: { message?: string };
  message?: string | { content?: { type?: string; name?: string; input?: unknown }[] };
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

const toolEvent = (name: string, input: unknown, server: string): AskEvent => ({
  type: "tool",
  name: name.replace(new RegExp(`^mcp__${server}__`), ""),
  input: JSON.stringify(input ?? {}).slice(0, 200),
});

async function run(args: string[], onEvent: OnEvent, agent: Agent, cwd: string, server: string): Promise<AskResult> {
  const onDelta = (text: string) => onEvent({ type: "text", text });
  const bin = await resolveCommand(agent);
  return new Promise((resolve) => {
    // stdin is closed, not piped: claude waits three seconds for piped input
    // before giving up on it.
    const child = spawn(bin.file, [...bin.args, ...args], {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill(), TURN_TIMEOUT_MS);
    let text = "";
    let stderr = "";
    let failed = false;
    let buffered = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      let nl: number;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let msg: StreamLine;
        try {
          msg = JSON.parse(line) as StreamLine;
        } catch {
          continue;
        }
        if (agent === "codex" && msg.type === "item.started" && msg.item?.type === "mcp_tool_call") {
          onEvent(toolEvent(msg.item.tool ?? "tool", msg.item.arguments, server));
        } else if (agent === "claude" && msg.type === "assistant" && typeof msg.message === "object") {
          for (const block of msg.message.content ?? []) if (block.type === "tool_use") onEvent(toolEvent(block.name ?? "tool", block.input, server));
        } else if (agent === "codex" && msg.type === "item.completed" && msg.item?.type === "agent_message") {
          const delta = (text ? "\n\n" : "") + (msg.item.text ?? "");
          text += delta;
          onDelta(delta);
        } else if (agent === "codex" && (msg.type === "turn.failed" || msg.type === "error")) {
          failed = true;
          stderr = msg.error?.message ?? (typeof msg.message === "string" ? msg.message : "Codex turn failed");
        } else if (msg.type === "stream_event" && msg.event?.delta?.type === "text_delta") {
          const delta = msg.event.delta.text ?? "";
          text += delta;
          onDelta(delta);
        } else if (msg.type === "result" && msg.is_error) {
          failed = true;
          stderr = msg.result ?? stderr;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, text: "", error: `Could not run ${agent}: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (text.trim() && code === 0 && !failed) return resolve({ ok: true, text });
      resolve({
        ok: false,
        text,
        error: stderr.trim() || `${agent} exited with code ${code}`,
      });
    });
  });
}
