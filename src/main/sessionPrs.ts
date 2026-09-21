import fs from "node:fs";
import readline from "node:readline";
import { sessionAgent } from "../shared/agents.js";
import { prSummary, type IssuePr } from "./github.js";
import { transcriptPath } from "./indexer.js";
import { getSession } from "./sessions.js";
import { contentText } from "./transcripts.js";

// The pull requests an agent session opened, read back from its transcript:
// every `gh pr create` the agent ran, paired with the output that call
// printed, which is where the new PR's URL appears. The transcript is the
// only record that survives the session; hooks never see tool output.

const CREATE = /\bgh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\b/g;

export interface CreatedPr {
  repo: string;
  number: number;
  url: string;
}

/** The pull requests a transcript shows being created, in order, each once.
 *  Claude keeps calls in assistant `tool_use` blocks and their results in
 *  user `tool_result` blocks; Codex keeps `function_call` and
 *  `function_call_output` items. Both pair up on an id, so a URL only
 *  counts when it came out of a `gh pr create`. */
export function createdPrs(lines: Iterable<string>): CreatedPr[] {
  const creating = new Set<string>();
  const found = new Map<string, CreatedPr>();
  const collect = (text: string) => {
    for (const [url, repo, number] of text.matchAll(PR_URL)) found.set(url, { repo, number: Number(number), url });
  };
  for (const line of lines) {
    let row: Record<string, unknown>;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object") continue;
    const message = row.message as { content?: unknown } | undefined;
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type === "tool_use" && CREATE.test(JSON.stringify(block.input ?? ""))) creating.add(block.id);
      if (block?.type === "tool_result" && creating.has(block.tool_use_id)) collect(contentText(block.content));
    }
    const payload = row.payload as { call_id?: string; arguments?: unknown; input?: unknown; output?: unknown } | undefined;
    if (payload?.call_id) {
      if (CREATE.test(String(payload.arguments ?? payload.input ?? ""))) creating.add(payload.call_id);
      if (creating.has(payload.call_id) && payload.output !== undefined) collect(contentText(payload.output));
    }
  }
  return [...found.values()];
}

async function readLines(file: string): Promise<string[]> {
  const lines: string[] = [];
  const reader = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) if (line.length < 2_000_000) lines.push(line);
  return lines;
}

const TTL_MS = 30_000;
const cache = new Map<string, { expires: number; result: Promise<IssuePr[]> }>();

/** The session's pull requests with their current state on GitHub, newest
 *  first. Empty when the session opened none, or its transcript is gone. */
export function sessionPullRequests(sessionId: string): Promise<IssuePr[]> {
  const cached = cache.get(sessionId);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = (async () => {
    const session = getSession(sessionId);
    if (!session) return [];
    const agent = sessionAgent(sessionId);
    const file = session.transcript_path ?? transcriptPath(agent, sessionId.replace(/^codex:/, ""));
    if (!file || !fs.existsSync(file)) return [];
    const prs = await Promise.all(createdPrs(await readLines(file)).map((pr) => prSummary(pr.repo, pr.number)));
    return prs.filter((pr): pr is IssuePr => pr !== null).sort((a, b) => b.number - a.number);
  })().catch(() => []);
  cache.set(sessionId, { expires: Date.now() + TTL_MS, result });
  return result;
}

/** Forgets the cached states so a rescan asks GitHub again. */
export function invalidateSessionPullRequests(): void {
  cache.clear();
}
