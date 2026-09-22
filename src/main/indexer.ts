import { watch, type FSWatcher } from "chokidar";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promptTitle, sessionKey, type Agent } from "../shared/agents.js";
import { openDb } from "./db.js";
import { parseTranscriptLine, type TranscriptMetadata, type TranscriptMessage } from "./transcripts.js";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
export const CODEX_HOME = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const CODEX_DIRS = [path.join(CODEX_HOME, "sessions"), path.join(CODEX_HOME, "archived_sessions")];
let watcher: FSWatcher | undefined;
let indexing = Promise.resolve();

export interface IndexProgress { scanned: number; total: number; done: boolean }
let progress: IndexProgress = { scanned: 0, total: 0, done: false };
const progressListeners = new Set<(p: IndexProgress) => void>();
export function onIndexProgress(cb: (p: IndexProgress) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}
function setProgress(p: IndexProgress): void {
  progress = p;
  for (const cb of progressListeners) cb(p);
}
export function getIndexProgress(): IndexProgress { return progress; }

/** Only commit newline-terminated records: a writer may still be appending
 * the final JSON object, including part of a multibyte UTF-8 character. */
export async function indexFile(filePath: string, agent: Agent): Promise<void> {
  const db = openDb();
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) return;
  const saved = db.prepare("SELECT offset, metadata FROM indexed_files WHERE path = ?").get(filePath) as
    { offset: number; metadata: string | null } | undefined;
  let offset = saved && saved.offset <= stat.size ? saved.offset : 0;
  if (offset === stat.size) return;
  const meta: TranscriptMetadata = offset && saved?.metadata ? JSON.parse(saved.metadata) : {
    agent, sessionId: path.basename(filePath, ".jsonl"), project: path.basename(path.dirname(filePath)),
  };
  const rows: TranscriptMessage[] = [];
  let title: string | undefined;
  let pending = Buffer.alloc(0);
  const stream = fs.createReadStream(filePath, { start: offset });
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk]);
    let newline: number;
    while ((newline = pending.indexOf(10)) >= 0) {
      const start = offset;
      const line = pending.subarray(0, newline).toString("utf8");
      pending = pending.subarray(newline + 1);
      offset += newline + 1;
      if (line.length < 2 || line.length > 2_000_000) continue;
      try {
        const parsed = parseTranscriptLine(line, meta);
        if (parsed.title) title = parsed.title;
        if (parsed.message) rows.push({ ...parsed.message, key: parsed.message.key ?? `offset:${start}` });
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  const id = sessionKey(agent, meta.sessionId);
  db.transaction(() => {
    if (!meta.skip) {
      const insert = db.prepare("INSERT OR IGNORE INTO conv_messages (session_id, role, ts, text, source_key) VALUES (?, ?, ?, ?, ?)");
      for (const row of rows) insert.run(id, row.role, row.ts, row.text, row.key);
      const times = rows.flatMap((r) => r.ts === null ? [] : [r.ts]);
      db.prepare(`INSERT INTO conv_sessions (session_id, agent, project, cwd, title, started_at, last_at)
        VALUES (@id, @agent, @project, @cwd, @title, @first, @last)
        ON CONFLICT(session_id) DO UPDATE SET
          cwd = COALESCE(excluded.cwd, conv_sessions.cwd), project = excluded.project,
          title = COALESCE(@summary, conv_sessions.title, excluded.title),
          started_at = MIN(COALESCE(conv_sessions.started_at, excluded.started_at), excluded.started_at),
          last_at = MAX(COALESCE(conv_sessions.last_at, 0), excluded.last_at)`)
        .run({ id, agent, project: agent === "codex" ? path.basename(meta.cwd ?? "Codex") : meta.project,
          cwd: meta.cwd ?? null, title: title ?? (promptTitle(rows.find((r) => r.role === "user")?.text ?? "") || null),
          summary: title ?? null, first: times.length ? Math.min(...times) : stat.mtimeMs,
          last: times.length ? Math.max(...times) : stat.mtimeMs });
    }
    db.prepare(`INSERT INTO indexed_files (path, offset, mtime, metadata) VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime, metadata = excluded.metadata`)
      .run(filePath, offset, stat.mtimeMs, JSON.stringify(meta));
  })();
}

/** Where a session's transcript was indexed from, for sessions whose hooks
 *  never said (Codex, and sessions deck saw only through the index). */
export function transcriptPath(agent: Agent, sessionId: string): string | undefined {
  const row = openDb()
    .prepare("SELECT path FROM indexed_files WHERE json_extract(metadata, '$.agent') = ? AND json_extract(metadata, '$.sessionId') = ? ORDER BY mtime DESC LIMIT 1")
    .get(agent, sessionId) as { path: string } | undefined;
  return row?.path;
}

function transcriptAgent(file: string): Agent | undefined {
  if (!file.endsWith(".jsonl")) return;
  const relative = path.relative(PROJECTS_DIR, file);
  if (!relative.startsWith("..") && relative.split(path.sep).length === 2) return "claude";
  if (CODEX_DIRS.some((dir) => !path.relative(dir, file).startsWith(".."))) return "codex";
}

function listTranscripts(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== "subagents") return listTranscripts(file);
    return entry.isFile() && transcriptAgent(file) ? [file] : [];
  });
}

function enqueue(file: string): Promise<void> {
  const agent = transcriptAgent(file);
  if (!agent) return indexing;
  indexing = indexing.then(() => indexFile(file, agent)).catch((error) => console.warn(`Could not index ${file}:`, error));
  return indexing;
}

export function startIndexer(): void {
  const roots = [PROJECTS_DIR, ...CODEX_DIRS];
  const files = roots.flatMap(listTranscripts);
  setProgress({ scanned: 0, total: files.length, done: files.length === 0 });
  let scanned = 0;
  for (const file of files) {
    void enqueue(file).then(() => {
      scanned++;
      if (scanned % 25 === 0 || scanned === files.length) setProgress({ scanned, total: files.length, done: scanned === files.length });
    });
  }
  watcher = watch(roots, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 } });
  watcher.on("add", (file) => void enqueue(file));
  watcher.on("change", (file) => void enqueue(file));
  watcher.on("error", (error) => console.warn("Transcript watcher:", error));
}

export function stopIndexer(): void {
  void watcher?.close();
  watcher = undefined;
}

export interface SearchHit {
  session_id: string;
  agent: Agent;
  project: string;
  cwd: string | null;
  title: string | null;
  last_at: number | null;
  snippet: string;
  role: string;
  ts: number | null;
}

export function searchConversations(query: string, limit = 40): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  // Quote each term so user input can't break FTS5 query syntax.
  const ftsQuery = q
    .split(/\s+/)
    .map((t) => `"${t.replaceAll('"', '""')}"*`)
    .join(" ");
  return openDb()
    .prepare(
      `SELECT m.session_id, s.agent, s.project, s.cwd, s.title, s.last_at, m.role, m.ts,
              snippet(conv_fts, 0, '⟪', '⟫', '...', 18) AS snippet
       FROM conv_fts
       JOIN conv_messages m ON m.id = conv_fts.rowid
       JOIN conv_sessions s ON s.session_id = m.session_id
       WHERE conv_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as SearchHit[];
}

export interface ConvMessage {
  role: string;
  ts: number | null;
  text: string;
}

export function sessionMessages(sessionId: string): ConvMessage[] {
  return openDb()
    .prepare("SELECT role, ts, text FROM conv_messages WHERE session_id = ? ORDER BY id")
    .all(sessionId) as ConvMessage[];
}

/** The tail of a conversation, oldest first — what a session last said. */
export function lastMessages(sessionId: string, limit: number): ConvMessage[] {
  return (
    openDb()
      .prepare("SELECT role, ts, text FROM conv_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as ConvMessage[]
  ).reverse();
}
