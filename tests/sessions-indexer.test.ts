import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.directory } }));
state.directory = fs.mkdtempSync(path.join(os.tmpdir(), "deck-test-"));
const { openDb, kvGet } = await import("../src/main/db.js");
const { applyHook, listSessions, linkTermToIssue, linkTermToWorkspace, moveTermSessions, registerAgentTerm, requestReview, endTermSessions, updateForegroundSession } = await import("../src/main/sessions.js");
const { indexFile, searchConversations, sessionMessages } = await import("../src/main/indexer.js");

beforeEach(() => {
  openDb().exec("DELETE FROM agent_sessions; DELETE FROM conv_messages; DELETE FROM conv_sessions; DELETE FROM indexed_files; INSERT INTO conv_fts(conv_fts) VALUES ('rebuild');");
});
afterAll(() => { openDb().close(); fs.rmSync(state.directory, { recursive: true, force: true }); });

const record = (type: string, payload: unknown, timestamp = "2026-09-07T10:00:00Z") => JSON.stringify({ type, payload, timestamp }) + "\n";

describe("provider session lifecycle", () => {
  it("identifies a manually launched Codex before the first prompt and clears it on exit", () => {
    const term = { id: "shell", cwd: "/repo" };
    updateForegroundSession({ ...term, foregroundProcess: "zsh" });
    expect(listSessions()).toEqual([]);
    updateForegroundSession({ ...term, foregroundProcess: "codex" });
    expect(listSessions()).toEqual([expect.objectContaining({ session_id: "pending:shell", agent: "codex", title: null, status: "idle", term_id: "shell" })]);
    updateForegroundSession({ ...term, foregroundProcess: "zsh" });
    expect(listSessions()).toEqual([]);
  });
  it("lets hooks replace foreground detection without resetting the real session", () => {
    const term = { id: "shell", cwd: "/repo", foregroundProcess: "codex" };
    updateForegroundSession(term);
    applyHook({ session_id: "started", hook_event_name: "UserPromptSubmit", prompt: "Fix startup" }, term.id, "codex");
    updateForegroundSession(term);
    updateForegroundSession({ ...term, foregroundProcess: "zsh" });
    expect(listSessions()).toEqual([expect.objectContaining({ session_id: "codex:started", title: "Fix startup", status: "working", term_id: "shell" })]);
  });
  it("updates the provider when another agent replaces a pre-hook process", () => {
    updateForegroundSession({ id: "shell", cwd: "/repo", foregroundProcess: "/usr/local/bin/codex" });
    updateForegroundSession({ id: "shell", cwd: "/repo", foregroundProcess: "claude" });
    expect(listSessions()).toEqual([expect.objectContaining({ agent: "claude", status: "idle" })]);
  });
  it("files a session under the workspace its terminal was opened in", () => {
    linkTermToWorkspace("term", "saba");
    registerAgentTerm({ id: "term", cwd: "/repo", agent: "claude", workspace: "saba" });
    applyHook({ session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "Hi", cwd: "/repo" }, "term");
    applyHook({ session_id: "outside", hook_event_name: "UserPromptSubmit", prompt: "Hi", cwd: "/elsewhere" }, null);
    expect(listSessions().find((s) => s.session_id === "s1")?.workspace).toBe("saba");
    expect(listSessions().find((s) => s.session_id === "outside")?.workspace).toBeNull();
  });
  it("moves a terminal's sessions to another workspace, and files later hooks there", () => {
    linkTermToWorkspace("term", "saba");
    applyHook({ session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "Hi", cwd: "/repo" }, "term");
    moveTermSessions("term", "convozy");
    applyHook({ session_id: "s2", hook_event_name: "UserPromptSubmit", prompt: "Hi again", cwd: "/repo" }, "term");
    expect(listSessions().map((s) => s.workspace)).toEqual(["convozy", "convozy"]);
  });
  it("remembers a terminal's workspace in the db, and forgets it once the terminal is gone", () => {
    moveTermSessions("term", "convozy");
    expect(kvGet<Record<string, string>>("term_workspaces")).toMatchObject({ term: "convozy" });
    endTermSessions("term");
    expect(kvGet<Record<string, string>>("term_workspaces")?.term).toBeUndefined();
  });
  it("links Codex to its terminal and ticket without duplicating the pending row", () => {
    registerAgentTerm({ id: "term", cwd: "/repo", agent: "codex", issueKey: "ABC-1" });
    linkTermToIssue("term", "ABC-1");
    applyHook({ session_id: "same", hook_event_name: "UserPromptSubmit", prompt: "Fix issue", cwd: "/repo" }, "term", "codex");
    applyHook({ session_id: "same", hook_event_name: "SessionStart" }, null);
    expect(listSessions()).toHaveLength(2);
    expect(listSessions().find((s) => s.agent === "codex")).toMatchObject({ session_id: "codex:same", term_id: "term", issue_key: "ABC-1", title: "Fix issue", status: "working" });
  });
  it("only treats blocking notifications as needing input", () => {
    const notify = (notification_type: string) => applyHook({ session_id: "n", hook_event_name: "Notification", notification_type }, "term");
    applyHook({ session_id: "n", hook_event_name: "Stop" }, "term");
    notify("idle_prompt");
    expect(listSessions()[0].status).toBe("idle");
    notify("auth_success");
    expect(listSessions()[0].status).toBe("idle");
    notify("permission_prompt");
    expect(listSessions()[0].status).toBe("needs_input");
  });
  it("tracks approval, recovery, review, interruption and termination", () => {
    const hook = (event: string) => applyHook({ session_id: "test", hook_event_name: event }, "term", "codex");
    hook("PermissionRequest");
    expect(listSessions()[0].status).toBe("needs_input");
    hook("PostToolUse");
    expect(listSessions()[0].status).toBe("working");
    requestReview("term", "Check the edge case");
    hook("Stop");
    expect(listSessions()[0]).toMatchObject({ status: "needs_review", review_note: "Check the edge case" });
    hook("UserPromptSubmit");
    expect(listSessions()[0].review_note).toBeNull();
    hook("Interrupt");
    expect(listSessions()[0].status).toBe("idle");
    endTermSessions("term");
    expect(listSessions()[0]).toMatchObject({ status: "ended", term_id: null });
  });
});

describe("conversation indexing", () => {
  it("indexes legacy Codex chat, excludes tool traffic and resumes appends with metadata", async () => {
    const file = path.join(state.directory, "rollout.jsonl");
    fs.writeFileSync(file, record("session_meta", { id: "legacy", cwd: "/work/repo", source: "cli" }) +
      record("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "searchable unicorn" }] }) +
      record("event_msg", { type: "user_message", message: "searchable unicorn" }) +
      record("response_item", { type: "function_call_output", output: "secret tool output" }));
    await indexFile(file, "codex");
    fs.appendFileSync(file, record("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "unicorn fixed" }] }, "2026-09-07T10:03:00Z"));
    await indexFile(file, "codex");
    await indexFile(file, "codex");
    expect(sessionMessages("codex:legacy")).toHaveLength(2);
    expect(searchConversations("unicorn")[0]).toMatchObject({ agent: "codex", cwd: "/work/repo", project: "repo", last_at: Date.parse("2026-09-07T10:03:00Z") });
    expect(searchConversations("secret")).toEqual([]);
  });
  it("indexes paginated user and assistant messages exactly once, including archived copies", async () => {
    const file = path.join(state.directory, "paginated.jsonl");
    fs.writeFileSync(file, record("session_meta", { id: "paged", cwd: "/repo", history_mode: "paginated", source: "cli" }) +
      record("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "duplicate" }] }) +
      record("event_msg", { type: "item_completed", item: { type: "UserMessage", id: "u", content: [{ type: "text", text: "Find café" }] } }) +
      record("event_msg", { type: "item_completed", item: { type: "AgentMessage", id: "a", content: [{ type: "Text", text: "café found" }] } }));
    await indexFile(file, "codex");
    const archive = path.join(state.directory, "archive.jsonl");
    fs.copyFileSync(file, archive);
    await indexFile(archive, "codex");
    expect(sessionMessages("codex:paged").map((m) => m.text)).toEqual(["Find café", "café found"]);
  });
  it("waits for a complete UTF-8 record and skips malformed records", async () => {
    const file = path.join(state.directory, "partial.jsonl");
    fs.writeFileSync(file, record("session_meta", { id: "partial", cwd: "/repo" }));
    const message = Buffer.from(record("response_item", { type: "message", role: "user", content: "café incremental" }));
    const cut = message.indexOf(Buffer.from("é")) + 1;
    fs.appendFileSync(file, message.subarray(0, cut));
    await indexFile(file, "codex");
    expect(sessionMessages("codex:partial")).toEqual([]);
    fs.appendFileSync(file, message.subarray(cut));
    fs.appendFileSync(file, "{broken}\n");
    await indexFile(file, "codex");
    expect(sessionMessages("codex:partial")[0].text).toBe("café incremental");
  });
  it("preserves Claude history and excludes Codex subagents", async () => {
    const file = path.join(state.directory, "claude-session.jsonl");
    fs.writeFileSync(file, JSON.stringify({ type: "user", cwd: "/claude", timestamp: "2026-09-07", message: { content: [{ type: "text", text: "Claude searchable" }] } }) + "\n");
    await indexFile(file, "claude");
    expect(searchConversations("searchable")[0].agent).toBe("claude");
    fs.writeFileSync(file, record("session_meta", { id: "child", source: { subagent: {} } }) + record("response_item", { type: "message", role: "user", content: "hidden" }));
    await indexFile(file, "codex");
    expect(searchConversations("hidden")).toEqual([]);
  });
});
