import { sessionKey, type Agent } from "../shared/agents.js";
import { kvGet, kvSet, openDb } from "./db.js";

// Registry of Claude Code and Codex sessions, fed by hook callbacks. Sessions
// started outside deck are tracked too — they just carry no term_id.

export type SessionStatus = "working" | "needs_input" | "needs_review" | "idle" | "ended";

export interface AgentSession {
  session_id: string;
  agent: Agent;
  cwd: string;
  title: string | null;
  status: SessionStatus;
  term_id: string | null;
  transcript_path: string | null;
  issue_key: string | null;
  /** Workspace of the terminal the session ran in; null for sessions started
   *  outside deck or before workspaces existed. */
  workspace: string | null;
  /** The agent's decisions summary, set when it asks for review before pushing. */
  review_note: string | null;
  started_at: number;
  updated_at: number;
}

// Terminals spawned from a ticket carry the link until the session's first
// hook arrives and persists it.
const pendingLinks = new Map<string, string>();

export function linkTermToIssue(termId: string, issueKey: string): void {
  pendingLinks.set(termId, issueKey);
}

// Which workspace each live terminal belongs to. Hooks only carry the
// terminal id, so this is how sessions land in the right workspace; it is
// kept in the db because terminals outlive the main process.
const TERM_WORKSPACES_KEY = "term_workspaces";
const termWorkspaces = new Map<string, string>(Object.entries(kvGet<Record<string, string>>(TERM_WORKSPACES_KEY) ?? {}));
const saveTermWorkspaces = () => kvSet(TERM_WORKSPACES_KEY, Object.fromEntries(termWorkspaces));

export function linkTermToWorkspace(termId: string, workspace: string): void {
  if (termWorkspaces.get(termId) === workspace) return;
  termWorkspaces.set(termId, workspace);
  saveTermWorkspaces();
}

/** The workspace a terminal was opened in or moved to, as main knows it. */
export function termWorkspace(termId: string): string | undefined {
  return termWorkspaces.get(termId);
}

/** Moves a terminal's sessions along with it to another workspace. */
export function moveTermSessions(termId: string, workspace: string): void {
  linkTermToWorkspace(termId, workspace);
  openDb().prepare("UPDATE agent_sessions SET workspace = ? WHERE term_id = ?").run(workspace, termId);
  notify();
}

/** The deck-review skill posts here when the agent pauses for user
 *  verification before pushing: the tab flips to needs_review and carries
 *  the agent's decisions summary. */
export function requestReview(termId: string, note: string): void {
  const changed = openDb()
    .prepare(
      "UPDATE agent_sessions SET status = 'needs_review', review_note = ?, updated_at = ? WHERE term_id = ? AND status != 'ended'",
    )
    .run(note, Date.now(), termId).changes;
  if (changed > 0) notify();
}

/** Session rows outlive their terminals; a term_id whose terminal is gone
 *  would mislabel whatever tab later reuses it. */
export function clearTermLinks(liveTermIds: string[]): void {
  const live = new Set(liveTermIds);
  for (const id of [...termWorkspaces.keys()]) if (!live.has(id)) termWorkspaces.delete(id);
  saveTermWorkspaces();
  const keep = liveTermIds.map(() => "?").join(",") || "''";
  openDb()
    .prepare(`UPDATE agent_sessions SET status = 'ended', term_id = NULL WHERE term_id IS NOT NULL AND term_id NOT IN (${keep})`)
    .run(...liveTermIds);
  openDb().prepare("DELETE FROM agent_sessions WHERE session_id LIKE 'pending:%' AND term_id IS NULL").run();
}

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;

export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  source?: string;
  notification_type?: string;
}

// Sessions deck itself runs (the "Ask deck" assistant) fire the same hooks
// as any other session; they are excluded so they never appear in the list
// they are describing.
const internalSessions = new Set<string>();

export function markInternalSession(id: string): void {
  internalSessions.add(id);
}

const listeners = new Set<() => void>();

export function onSessionsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}

export function removeSession(id: string): void {
  openDb().prepare("DELETE FROM agent_sessions WHERE session_id = ?").run(id);
  notify();
}

export function listSessions(limit = 100): AgentSession[] {
  return openDb()
    .prepare("SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as AgentSession[];
}

// Only notifications that block the turn on the user count as waiting.
// Claude also sends idle_prompt (a minute after a turn ended) and
// auth_success, which say nothing about the agent needing anything.
const BLOCKING_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog"]);

const eventStatus: Record<string, SessionStatus> = {
  SessionStart: "idle",
  UserPromptSubmit: "working",
  Notification: "needs_input",
  PermissionRequest: "needs_input",
  Interrupt: "idle",
  PreToolUse: "working",
  // A completed tool call is the proof the agent resumed after a permission
  // prompt — without it, needs_input would stick until the next Stop.
  PostToolUse: "working",
  Stop: "idle",
  SessionEnd: "ended",
};

export function applyHook(payload: HookPayload, termId: string | null, agent: Agent = "claude"): void {
  const id = payload.session_id ? sessionKey(agent, payload.session_id) : undefined;
  const status = payload.hook_event_name === "PreToolUse" && /(?:request_user_input|AskUserQuestion)/.test(payload.tool_name ?? "")
    ? "needs_input"
    : payload.hook_event_name ? eventStatus[payload.hook_event_name] : undefined;
  if (!id || !status || internalSessions.has(id)) return;
  if (payload.hook_event_name === "SessionStart" && payload.source === "compact") return;
  if (payload.hook_event_name === "Notification" && !BLOCKING_NOTIFICATIONS.has(payload.notification_type ?? "")) return;

  const db = openDb();
  const now = Date.now();
  const linked = termId ? (pendingLinks.get(termId) ?? null) : null;
  // needs_review is set mid-turn (by the deck-review skill), so the same
  // turn's own PostToolUse/Stop events must not downgrade it. It clears when
  // the user replies (UserPromptSubmit) or the session ends.
  db.prepare(
    `INSERT INTO agent_sessions (session_id, agent, cwd, status, term_id, transcript_path, issue_key, workspace, started_at, updated_at)
     VALUES (@id, @agent, @cwd, @status, @termId, @transcript, @issueKey, @workspace, @now, @now)
     ON CONFLICT(session_id) DO UPDATE SET
       status = CASE
         WHEN agent_sessions.status = 'needs_review' AND @event IN ('PreToolUse', 'PostToolUse', 'Stop', 'Interrupt')
           THEN 'needs_review'
         ELSE @status
       END,
       review_note = CASE
         WHEN @event = 'UserPromptSubmit' THEN NULL
         ELSE agent_sessions.review_note
       END,
       updated_at = @now,
       cwd = COALESCE(NULLIF(@cwd, ''), cwd),
       term_id = COALESCE(@termId, term_id),
       transcript_path = COALESCE(@transcript, transcript_path),
       issue_key = COALESCE(agent_sessions.issue_key, @issueKey),
       workspace = COALESCE(agent_sessions.workspace, @workspace)`,
  ).run({
    id,
    agent,
    cwd: payload.cwd ?? "",
    status,
    event: payload.hook_event_name,
    termId,
    transcript: payload.transcript_path ?? null,
    issueKey: linked,
    workspace: termId ? (termWorkspaces.get(termId) ?? null) : null,
    now,
  });

  // One live session per terminal: a new session id in the same deck tab
  // supersedes whatever ran there before (e.g. `claude --resume` forks a new
  // session id and would otherwise leave the old row dangling forever).
  if (termId && payload.hook_event_name !== "SessionEnd") {
    db.prepare("DELETE FROM agent_sessions WHERE session_id = ?").run(`pending:${termId}`);
    db.prepare(
      "UPDATE agent_sessions SET status = 'ended', updated_at = ? WHERE term_id = ? AND session_id != ?",
    ).run(now, termId, id);
  }

  // The first prompt of a session becomes its title, and an issue key
  // mentioned in it links the session to that ticket.
  if (payload.hook_event_name === "UserPromptSubmit" && payload.prompt) {
    db.prepare(
      "UPDATE agent_sessions SET title = COALESCE(title, ?) WHERE session_id = ?",
    ).run(payload.prompt.slice(0, 120), id);
    const key = ISSUE_KEY_RE.exec(payload.prompt)?.[0];
    if (key) {
      db.prepare(
        "UPDATE agent_sessions SET issue_key = COALESCE(issue_key, ?) WHERE session_id = ?",
      ).run(key, id);
    }
  }
  notify();
}

export function registerAgentTerm(term: { id: string; cwd: string; agent?: Agent; sessionId?: string; prompt?: string; issueKey?: string; workspace?: string }): void {
  if (!term.agent) return;
  // A fast startup hook can arrive before the create response.
  if (openDb().prepare("SELECT 1 FROM agent_sessions WHERE term_id = ? AND status != 'ended' AND session_id NOT LIKE 'pending:%'").get(term.id)) return;
  const id = term.sessionId ?? `pending:${term.id}`;
  openDb().prepare(`INSERT INTO agent_sessions (session_id, agent, cwd, title, status, term_id, issue_key, workspace, started_at, updated_at)
    VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET agent = excluded.agent, term_id = excluded.term_id, status = 'idle', updated_at = excluded.updated_at`)
    .run(id, term.agent, term.cwd, term.prompt?.slice(0, 120) ?? null, term.id, term.issueKey ?? null, term.workspace ?? termWorkspaces.get(term.id) ?? null, Date.now(), Date.now());
  notify();
}

export function updateForegroundSession(term: { id: string; cwd: string; foregroundProcess?: string; issueKey?: string }): void {
  const processName = term.foregroundProcess?.split("/").pop();
  if (processName === "codex" || processName === "claude") {
    registerAgentTerm({ id: term.id, cwd: term.cwd, agent: processName, issueKey: term.issueKey });
    return;
  }
  // Hooks own real session status. Only remove the pre-hook placeholder
  // when the agent gives the terminal back to another process.
  const changed = openDb().prepare("DELETE FROM agent_sessions WHERE session_id = ?").run(`pending:${term.id}`).changes;
  if (changed > 0) notify();
}

export function endTermSessions(termId: string): void {
  pendingLinks.delete(termId);
  termWorkspaces.delete(termId);
  saveTermWorkspaces();
  openDb().prepare("DELETE FROM agent_sessions WHERE session_id = ?").run(`pending:${termId}`);
  openDb().prepare("UPDATE agent_sessions SET status = 'ended', term_id = NULL, updated_at = ? WHERE term_id = ?")
    .run(Date.now(), termId);
  notify();
}
