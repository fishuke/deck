import type { AgentLaunch } from "../shared/agents.js";
import type { WindowRole } from "../shared/settings.js";
// Standalone pty host. Runs detached from Electron (via ELECTRON_RUN_AS_NODE)
// so shells survive main-process restarts in dev, window reloads and closed
// windows. Deck's main process is a thin client over a unix socket; the
// protocol is newline-delimited JSON. Keeps recent output per terminal so a
// reconnecting renderer can replay it.
import net from "node:net";
import { randomUUID } from "node:crypto";
import pty, { type IPty } from "node-pty";
import { readCwds } from "./ptyCwd.js";

export interface TermMeta extends AgentLaunch {
  id: string;
  cwd: string;
  foregroundProcess?: string;
  /** A program other than the shell holds the terminal, so it is not at a prompt. */
  busy?: boolean;
  command?: string;
  issueKey?: string;
  windowRole?: WindowRole;
  /** Workspace the terminal was opened in; only that workspace lists it. */
  workspace?: string;
}

export interface SpawnRequest extends AgentLaunch {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  command?: string;
  issueKey?: string;
  windowRole?: WindowRole;
  workspace?: string;
}

export type ClientMessage =
  | { type: "create"; req: number; spawn: SpawnRequest }
  | { type: "list"; req: number }
  | { type: "attach"; req: number; id: string }
  | { type: "input"; id: string; data: string }
  | { type: "resize"; id: string; cols: number; rows: number }
  | { type: "kill"; id: string }
  | { type: "workspace"; id: string; workspace: string }
  | { type: "shutdown" };

export type HostMessage =
  | { type: "created"; req: number; meta: TermMeta }
  | { type: "list"; req: number; terms: TermMeta[] }
  | { type: "attached"; req: number; id: string; buffer: string; cols: number; rows: number }
  | { type: "data"; id: string; data: string }
  | { type: "foreground"; meta: TermMeta }
  | { type: "cwd"; id: string; cwd: string }
  | { type: "exit"; id: string; code: number };

// Enough to rebuild a busy TUI's screen on reattach without holding whole
// sessions in memory.
const BUFFER_LIMIT = 1_000_000;

interface Term {
  proc: IPty;
  meta: TermMeta;
  /** Process name of the shell itself, to tell a prompt from a running program. */
  shell?: string;
  chunks: string[];
  buffered: number;
}

const socketPath = process.argv[2];
if (!socketPath) {
  console.error("usage: ptyHost <socket path>");
  process.exit(2);
}

const terms = new Map<string, Term>();
const clients = new Set<net.Socket>();

function send(socket: net.Socket, msg: HostMessage): void {
  if (!socket.destroyed) socket.write(JSON.stringify(msg) + "\n");
}

function broadcast(msg: HostMessage): void {
  for (const c of clients) send(c, msg);
}

// Nobody attached and nothing running: no reason to linger. This is also
// how a rebuilt ptyHost gets picked up — the next deck start spawns it.
function exitIfIdle(): void {
  if (terms.size === 0 && clients.size === 0) {
    server.close();
    process.exit(0);
  }
}

function create(spawn: SpawnRequest): TermMeta {
  const id = randomUUID();
  const proc = pty.spawn(spawn.shell, spawn.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: spawn.cwd,
    env: { ...spawn.env, DECK_TERM_ID: id },
  });
  const shell = spawn.shell.split("/").pop();
  const meta: TermMeta = { id, cwd: spawn.cwd, foregroundProcess: proc.process, busy: proc.process !== shell, command: spawn.command, issueKey: spawn.issueKey, agent: spawn.agent, sessionId: spawn.sessionId, prompt: spawn.prompt, windowRole: spawn.windowRole, workspace: spawn.workspace };
  const term: Term = { proc, meta, shell, chunks: [], buffered: 0 };

  proc.onData((data) => {
    term.chunks.push(data);
    term.buffered += data.length;
    // Drop whole chunks so a replay doesn't start mid escape sequence.
    while (term.buffered > BUFFER_LIMIT && term.chunks.length > 1) {
      term.buffered -= term.chunks.shift()!.length;
    }
    broadcast({ type: "data", id, data });
  });
  proc.onExit(({ exitCode }) => {
    terms.delete(id);
    broadcast({ type: "exit", id, code: exitCode });
    exitIfIdle();
  });

  terms.set(id, term);
  return meta;
}

// An agent can sit at its welcome screen before its first session hook.
// Poll the PTY's foreground process even when it produces no output.
setInterval(() => {
  for (const term of terms.values()) {
    const foregroundProcess = term.proc.process;
    if (foregroundProcess === term.meta.foregroundProcess) continue;
    term.meta.foregroundProcess = foregroundProcess;
    term.meta.busy = foregroundProcess !== term.shell;
    broadcast({ type: "foreground", meta: term.meta });
  }
}, 500).unref();

// Slower than the foreground poll: it shells out, and a cd only matters to
// the chrome showing the folder, its branch and its diff.
setInterval(() => {
  const live = [...terms.values()];
  void readCwds(live.map((term) => term.proc.pid)).then((cwds) => {
    for (const term of live) {
      const cwd = cwds.get(term.proc.pid);
      if (!cwd || cwd === term.meta.cwd) continue;
      term.meta.cwd = cwd;
      broadcast({ type: "cwd", id: term.meta.id, cwd });
    }
  }).catch(() => {});
}, 2000).unref();

function handle(socket: net.Socket, msg: ClientMessage): void {
  switch (msg.type) {
    case "create":
      send(socket, { type: "created", req: msg.req, meta: create(msg.spawn) });
      return;
    case "list":
      send(socket, { type: "list", req: msg.req, terms: [...terms.values()].map((t) => t.meta) });
      return;
    case "attach": {
      const term = terms.get(msg.id);
      // The replay was rendered at the pty's current size; a pane must lay it
      // out at that size before fitting to its own, or wrapped lines garble.
      send(socket, { type: "attached", req: msg.req, id: msg.id, buffer: term?.chunks.join("") ?? "", cols: term?.proc.cols ?? 0, rows: term?.proc.rows ?? 0 });
      return;
    }
    case "input":
      terms.get(msg.id)?.proc.write(msg.data);
      return;
    case "resize":
      if (msg.cols > 0 && msg.rows > 0) terms.get(msg.id)?.proc.resize(msg.cols, msg.rows);
      return;
    case "kill":
      terms.get(msg.id)?.proc.kill();
      return;
    case "workspace": {
      const term = terms.get(msg.id);
      if (term) term.meta.workspace = msg.workspace;
      return;
    }
    case "shutdown":
      for (const t of terms.values()) t.proc.kill();
      server.close();
      process.exit(0);
  }
}

const server = net.createServer((socket) => {
  clients.add(socket);
  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk.toString();
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (line) handle(socket, JSON.parse(line) as ClientMessage);
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    clients.delete(socket);
    exitIfIdle();
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  // Another host already owns the socket; let it serve.
  console.error(`pty host failed to listen: ${err.code ?? err.message}`);
  process.exit(1);
});

// A stale socket file is removed by the client before it spawns us, so a
// live host owning the path surfaces as EADDRINUSE instead of being cut off.
server.listen(socketPath, () => console.log(`pty host listening on ${socketPath}`));

// Spawned detached, so the client's death and its terminal closing never
// reach us; a controlling-terminal hangup is the one stray signal to ignore.
process.on("SIGHUP", () => {});
