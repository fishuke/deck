import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.root } }));
state.root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-upgrade-"));
vi.spyOn(os, "homedir").mockImplementation(() => state.root);
vi.stubEnv("CODEX_HOME", path.join(state.root, "codex"));
const { installHooks, hooksInstalled } = await import("../src/main/hooksInstall.js");
const { openDb } = await import("../src/main/db.js");
afterAll(() => { openDb().close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(state.root, { recursive: true, force: true }); });

describe("provider hook installation", () => {
  it.each(["claude", "codex"] as const)("preserves %s's existing hooks and settings on repeated installs", (agent) => {
    const root = agent === "claude" ? path.join(state.root, ".claude") : path.join(state.root, "codex");
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, agent === "claude" ? "settings.json" : "hooks.json");
    const existing = { matcher: "custom", hooks: [{ type: "command", command: "echo custom-hook" }] };
    fs.writeFileSync(file, JSON.stringify({ preserved: true, hooks: { Stop: [existing] } }));
    expect(hooksInstalled(agent)).toBe(false);
    expect(installHooks(agent).installed).toBe(true);
    const first = fs.readFileSync(file, "utf8");
    expect(installHooks(agent).installed).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
    const settings = JSON.parse(first);
    expect(settings.preserved).toBe(true);
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0]).toEqual(existing);
    expect(settings.hooks.Stop[1].hooks[0].command).toContain(`x-deck-agent: ${agent}`);
    expect(hooksInstalled(agent)).toBe(true);
    expect(fs.existsSync(path.join(root, "skills", "deck-review", "SKILL.md"))).toBe(true);
  });

  it("rewrites a hook an older deck installed with its port baked in", () => {
    const file = path.join(state.root, ".claude", "settings.json");
    const baked = `curl -s -m 3 -X POST 'http://127.0.0.1:47800/api/hook' -H 'x-deck-term: '"$DECK_TERM_ID" -H 'x-deck-agent: claude' -H 'Content-Type: application/json' --data-binary @- >/dev/null || true`;
    fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: baked }] }] } }));
    expect(installHooks("claude").installed).toBe(true);
    const stop = JSON.parse(fs.readFileSync(file, "utf8")).hooks.Stop;
    expect(stop).toHaveLength(1);
    expect(stop[0].hooks[0].command).toContain("${DECK_PORT:-47800}");
    expect(installHooks("claude").installed).toBe(false);
  });
});

describe("database upgrade", () => {
  it("preserves existing Claude session IDs, transcript rows and FTS search", () => {
    const old = new Database(path.join(state.root, "deck.db"));
    old.exec(`
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE agent_sessions (claude_session_id TEXT PRIMARY KEY, agent TEXT DEFAULT 'claude', cwd TEXT, title TEXT, status TEXT, term_id TEXT, transcript_path TEXT, started_at INTEGER, updated_at INTEGER, issue_key TEXT, review_note TEXT);
      CREATE TABLE indexed_files (path TEXT PRIMARY KEY, offset INTEGER, mtime INTEGER);
      CREATE TABLE conv_sessions (session_id TEXT PRIMARY KEY, project TEXT, cwd TEXT, title TEXT, started_at INTEGER, last_at INTEGER);
      CREATE TABLE conv_messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, ts INTEGER, text TEXT);
      CREATE VIRTUAL TABLE conv_fts USING fts5(text, content='conv_messages', content_rowid='id');
      INSERT INTO agent_sessions (claude_session_id, cwd, status) VALUES ('old-claude', '/repo', 'idle');
      INSERT INTO conv_sessions (session_id, project) VALUES ('old-claude', 'repo');
      INSERT INTO conv_messages VALUES (1, 'old-claude', 'user', 1, 'searchable history');
      INSERT INTO conv_fts(conv_fts) VALUES ('rebuild');
      PRAGMA user_version = 5;
    `);
    old.close();
    const db = openDb();
    expect(db.prepare("SELECT session_id FROM agent_sessions").get()).toEqual({ session_id: "old-claude" });
    expect(db.prepare("SELECT agent FROM conv_sessions").get()).toEqual({ agent: "claude" });
    expect(db.prepare("SELECT text FROM conv_fts WHERE conv_fts MATCH 'searchable'").get()).toEqual({ text: "searchable history" });
    expect(db.pragma("user_version", { simple: true })).toBe(6);
  });
});
