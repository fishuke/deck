import type { Agent } from "../shared/agents.js";
import { checkoutFor, fixPrompt, runningFixes, startFix, type FixProblem } from "./autofix.js";
import { prDetail } from "./github.js";
import { lastMessages } from "./indexer.js";
import { canShareBoard, canSharePullRequests, canShareSession, sharedSessions, WITHHELD } from "./sharing.js";
import { createIssue, getBoardCache, searchIssues } from "./board/board.js";
import { boardProvider } from "./board/provider.js";
import { attentionReasons, getPrInbox, prsAwaitingReview, refreshPrInbox, type InboxPr } from "./prInbox.js";
import { listRepos } from "./providers.js";
import { createTerm, sendToTerm } from "./pty.js";
import { getSettings } from "./settings.js";
import { listSessions } from "./sessions.js";

// The tools the agent page's assistant gets, served over MCP (streamable
// HTTP, JSON responses) from deck's own server. This is what turns "ask deck"
// into an orchestrator: it can start agents, talk to them and act on PRs.

export type Json = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: Json) => Promise<unknown>;
}

export const str = (description: string) => ({ type: "string", description });
export const schema = (properties: Json, required: string[] = []) => ({ type: "object", properties, required });

function requirePr(args: Json): InboxPr {
  const repo = String(args.repo ?? "");
  const number = Number(args.number);
  const inbox = getPrInbox();
  const pr = [...(inbox?.mine ?? []), ...(inbox?.reviewRequested ?? []), ...(inbox?.reviewed ?? [])].find((p) => p.repo === repo && p.number === number);
  if (!pr) throw new Error(`PR ${repo}#${number} is not in the inbox; call pr_inbox first`);
  return pr;
}

function describeInbox() {
  const inbox = getPrInbox();
  if (!inbox) return { error: "No PR data yet: gh may be unauthenticated or the first refresh is still running" };
  const fixes = runningFixes();
  return {
    viewer: inbox.viewer,
    at: new Date(inbox.at).toISOString(),
    mine: inbox.mine.map((pr) => ({
      ...pr,
      needsAttention: attentionReasons(pr),
      checkout: checkoutFor(pr.repo) ?? null,
      fixInProgress: fixes.filter((f) => f.repo === pr.repo && f.number === pr.number).map((f) => ({ problem: f.problem, term_id: f.termId })),
    })),
    reviewRequested: prsAwaitingReview(inbox),
    alreadyReviewed: inbox.reviewed ?? [],
  };
}

const tools: Tool[] = [
  {
    name: "list_sessions",
    description: "Live agent sessions deck tracks (Claude Code and Codex), with status, project, ticket and terminal. Statuses: working, needs_input, needs_review, idle.",
    inputSchema: schema({}),
    run: async () => sharedSessions(),
  },
  {
    name: "read_session",
    description: "The last messages of an agent session's transcript, to learn what it did or what it is asking.",
    inputSchema: schema({ session_id: str("Session id from list_sessions"), limit: { type: "integer", description: "Messages to return, default 20" } }, ["session_id"]),
    run: async (args) => {
      const sessionId = String(args.session_id);
      if (!canShareSession(sessionId)) throw new Error(`That session is not shared with you. ${WITHHELD}`);
      return lastMessages(sessionId, Number(args.limit) || 20);
    },
  },
  {
    name: "send_to_session",
    description: "Type a message into a running agent session's terminal and submit it: answer its question, approve its plan, or give it a follow-up task.",
    inputSchema: schema({ session_id: str("Session id from list_sessions"), text: str("What to send") }, ["session_id", "text"]),
    run: async (args) => {
      const session = listSessions().find((s) => s.session_id === args.session_id);
      if (!session?.term_id) throw new Error("That session is not running in a deck terminal");
      sendToTerm(session.term_id, String(args.text));
      return { ok: true, term_id: session.term_id };
    },
  },
  {
    name: "start_agent",
    description: "Start a new Claude Code or Codex agent in a deck terminal with an opening prompt. Use for delegating work: fixing a ticket, investigating a repo, drafting a plan. Returns the terminal id; the session appears in list_sessions once it reports in.",
    inputSchema: schema({
      cwd: str("Absolute directory to run in; or give repo"),
      repo: str("Repository name (directory under the repo roots, or owner/name) when cwd is unknown"),
      prompt: str("The opening instruction for the agent"),
      agent: { type: "string", enum: ["claude", "codex"], description: "Defaults to the user's default agent" },
      issue_key: str("Board issue key to link the session to"),
    }, ["prompt"]),
    run: async (args) => {
      const cwd = args.cwd ? String(args.cwd) : args.repo ? checkoutFor(String(args.repo)) : undefined;
      if (!cwd) throw new Error(`No local checkout found for ${String(args.repo ?? "(no repo given)")}; see list_repos`);
      const agent = (args.agent as Agent | undefined) ?? getSettings().defaultAgent;
      const meta = await createTerm({ cwd, agent, prompt: String(args.prompt), issueKey: args.issue_key ? String(args.issue_key) : undefined });
      return { term_id: meta.id, cwd, agent };
    },
  },
  {
    name: "list_repos",
    description: "Local repository checkouts deck knows about (name and path).",
    inputSchema: schema({}),
    run: async () => listRepos(),
  },
  {
    name: "pr_inbox",
    description: "The user's open pull requests (with review decision, CI state, mergeability, what needs attention and whether a fix agent is already on it) and PRs waiting on their review.",
    inputSchema: schema({ refresh: { type: "boolean", description: "Fetch fresh data from GitHub first" } }),
    run: async (args) => {
      if (!canSharePullRequests()) return { error: WITHHELD };
      if (args.refresh) await refreshPrInbox();
      return describeInbox();
    },
  },
  {
    name: "pr_detail",
    description: "Details of one pull request: checks, reviewers, commits, changed files.",
    inputSchema: schema({ repo: str("owner/name"), number: { type: "integer" } }, ["repo", "number"]),
    run: async (args) => {
      if (!canSharePullRequests()) throw new Error(WITHHELD);
      const detail = await prDetail(String(args.repo), Number(args.number));
      if (!detail) throw new Error("PR not found");
      const { files, commits, ...rest } = detail;
      return { ...rest, commits: commits.slice(-10), files: files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })) };
    },
  },
  {
    name: "fix_pr",
    description: "Start an agent on one of the user's PRs to fix failing CI, resolve merge conflicts, or address requested changes. Returns the existing fix if one is already running.",
    inputSchema: schema({
      repo: str("owner/name"),
      number: { type: "integer" },
      problem: { type: "string", enum: ["ci_failed", "conflicts", "changes_requested"] },
      agent: { type: "string", enum: ["claude", "codex"] },
    }, ["repo", "number", "problem"]),
    run: async (args) => {
      const pr = requirePr(args);
      const problem = args.problem as FixProblem;
      const fix = await startFix(pr, problem, args.agent as Agent | undefined);
      return { ...fix, prompt: fixPrompt(pr, problem) };
    },
  },
  {
    name: "search_issues",
    description: "Search the issue tracker beyond the board mirror: backlog, epics, other projects. The query is in the tracker's own language: JQL for Jira, free text for Linear, GitHub issue search syntax for GitHub Projects. Returns key, summary, status, type, assignee, priority, parent, description and url.",
    inputSchema: schema({ query: str('e.g. Jira: project = APP AND statusCategory = "To Do" ORDER BY priority; GitHub: is:open label:bug'), max: { type: "integer", description: "1-50, default 25" } }, ["query"]),
    run: async (args) => {
      if (!canShareBoard()) throw new Error(WITHHELD);
      return searchIssues(String(args.query), Number(args.max) || 25);
    },
  },
  {
    name: "create_issue",
    description: "Create an issue in the tracker. Only after the user has agreed to the exact summary; never create speculatively.",
    inputSchema: schema({
      project: str("Jira project key, Linear team key or GitHub owner/repo"),
      type: str("Issue type name for Jira, e.g. Task, Story, Epic; ignored by other trackers"),
      summary: str("One-line summary"),
      description: str("Plain text; blank lines separate paragraphs"),
      parent: str("Epic or parent issue key"),
    }, ["project", "summary"]),
    run: async (args) => createIssue({
      project: String(args.project), type: args.type ? String(args.type) : undefined, summary: String(args.summary),
      description: args.description ? String(args.description) : undefined, parent: args.parent ? String(args.parent) : undefined,
    }),
  },
];

/** The tracker deck's board mirrors, for prompts that name it. */
export const boardLabel = (): string => boardProvider().label;

/** The project keys on the board (APP for APP-12, repo for repo#12), so the
 *  assistant searches the right project. */
export function boardProjects(): string[] {
  return [...new Set((getBoardCache()?.issues ?? []).map((i) => /^(.+?)[-#]\d+$/.exec(i.key)?.[1] ?? i.key))];
}

export interface JsonRpc {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Json;
}

type RpcResponse = { status: number; body?: unknown };

/** Handles one MCP request; notifications get 202 with no body. The tool set
 *  defaults to the orchestrator's; the PR review assistant serves its own. */
export async function handleMcp(message: JsonRpc, available: Tool[] = tools): Promise<RpcResponse> {
  const reply = (result: unknown) => ({ status: 200, body: { jsonrpc: "2.0", id: message.id ?? null, result } });
  const fail = (code: number, text: string) => ({ status: 200, body: { jsonrpc: "2.0", id: message.id ?? null, error: { code, message: text } } });
  if (message.method.startsWith("notifications/")) return { status: 202 };
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: (message.params?.protocolVersion as string | undefined) ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "deck", version: "1" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: available.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = available.find((t) => t.name === message.params?.name);
      if (!tool) return fail(-32602, `Unknown tool ${String(message.params?.name)}`);
      try {
        const result = await tool.run((message.params?.arguments as Json | undefined) ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
      } catch (error) {
        return reply({ content: [{ type: "text", text: (error as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

export const toolNames = (): string[] => tools.map((t) => t.name);
