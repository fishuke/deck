import { agentCommand, sessionAgent, sessionKey, type AgentLaunch } from "../shared/agents.js";
import { app, BrowserWindow, ipcMain, type WebContents } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { SERVER_PORT } from "./port.js";
import type { ClientMessage, HostMessage, SpawnRequest, TermMeta } from "./ptyHost.js";
import { clearTermLinks, linkTermToIssue, registerAgentTerm, endTermSessions, updateForegroundSession } from "./sessions.js";
import { getSettings } from "./settings.js";
import type { WindowRole } from "../shared/settings.js";
import { LegacyAgentDetector } from "./legacyAgentDetection.js";

/** Role of each renderer, so terminals can be tagged with the window that
 *  opened them and, when the hotkey window keeps its own tabs, filtered. */
const windowRoles = new WeakMap<WebContents, WindowRole>();
export function setWindowRole(contents: WebContents, role: WindowRole): void {
  windowRoles.set(contents, role);
}
export function windowRoleOf(contents: WebContents): WindowRole {
  return windowRoles.get(contents) ?? "main";
}
function visibleTo(contents: WebContents, meta: TermMeta): boolean {
  const { windowMode, hotkeyOwnTabs } = getSettings();
  if (windowMode !== "panel" || !hotkeyOwnTabs) return true;
  return (meta.windowRole ?? "main") === windowRoleOf(contents);
}

export type { TermMeta } from "./ptyHost.js";

/** Scrollback of a pty plus the size it was rendered at. */
export interface TermReplay {
  buffer: string;
  sequence: number;
  cols: number;
  rows: number;
}

// Terminals run in a detached pty host (ptyHost.ts) so they outlive this
// process: dev watch-restarts, ⌘R and closed windows all just reattach.

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function startCwd(requested?: string): string {
  for (const candidate of [requested, getSettings().defaultCwd]) {
    if (!candidate) continue;
    const dir = expandHome(candidate);
    if (fs.existsSync(dir)) return dir;
  }
  return os.homedir();
}

export interface TermCreateOptions extends AgentLaunch {
  cwd?: string;
  /** Command to run instead of the login shell (e.g. `claude --resume <id>`). */
  command?: string;
  /** Ticket this terminal was spawned for — links its agent session. */
  issueKey?: string;
  windowRole?: WindowRole;
}

function spawnRequest(opts: TermCreateOptions): SpawnRequest {
  const shell = process.env.SHELL ?? "/bin/zsh";
  const agent = opts.agent ?? (opts.sessionId ? sessionAgent(opts.sessionId) : opts.prompt ? getSettings().defaultAgent : undefined);
  const sessionId = opts.sessionId && agent ? sessionKey(agent, opts.sessionId) : opts.sessionId;
  const command = agent ? agentCommand({ agent, sessionId, prompt: opts.prompt }) : opts.command;
  // Deck itself may have been launched from inside a Claude Code session
  // (dev mode); its CLAUDE* markers would make claude in this terminal
  // think it's a child session and disable transcript saving.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => !entry[0].startsWith("CLAUDE") && !["CODEX_THREAD_ID", "CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "DECK_TERM_ID"].includes(entry[0]) && entry[1] !== undefined,
    ),
  );
  return {
    shell,
    // A command still runs inside a login shell so PATH and profile apply,
    // and the tab drops back to the prompt when it exits.
    args: command ? ["-l", "-i", "-c", `${command}; exec ${shell} -l`] : ["-l"],
    cwd: startCwd(opts.cwd),
    env: {
      ...cleanEnv,
      // Start from the system baseline like Terminal.app, so the login
      // shell's own profile builds PATH. Inheriting an already-built PATH
      // makes "add if missing" guards in rc files skip their prepends,
      // resolving different binaries than the user's real terminal.
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TERM_PROGRAM: "deck",
      COLORTERM: "truecolor",
      // Agent hooks read the port from here, so they report to the deck
      // instance that spawned the terminal and not to another channel's.
      DECK_PORT: String(SERVER_PORT),
    },
    command,
    agent,
    sessionId,
    prompt: opts.prompt,
    issueKey: opts.issueKey,
    windowRole: opts.windowRole,
  };
}

type Reply = Extract<HostMessage, { req: number }>;
type Request = Extract<ClientMessage, { req: number }>;
type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, "req"> : never) : never;

class PtyHostClient {
  private socket?: net.Socket;
  private connecting?: Promise<net.Socket>;
  private nextReq = 1;
  private readonly pending = new Map<number, (reply: Reply) => void>();
  /** The renderer currently showing each terminal; set on attach. */
  private readonly owners = new Map<string, Set<WebContents>>();
  private readonly sequences = new Map<string, number>();

  private readonly socketPath = path.join(app.getPath("userData"), "pty.sock");
  private readonly logPath = path.join(app.getPath("userData"), "pty-host.log");

  async request<T extends Reply["type"]>(msg: RequestBody, onReply?: () => void): Promise<Extract<Reply, { type: T }>> {
    const socket = await this.connect();
    const req = this.nextReq++;
    return new Promise((resolve) => {
      this.pending.set(req, (reply) => { onReply?.(); resolve(reply as Extract<Reply, { type: T }>); });
      socket.write(JSON.stringify({ ...msg, req }) + "\n");
    });
  }

  send(msg: Exclude<ClientMessage, { req: number }>): void {
    void this.connect().then((socket) => socket.write(JSON.stringify(msg) + "\n"));
  }

  /** Attaches a renderer: it receives the replayed buffer, then live data. */
  async attach(id: string, owner: WebContents): Promise<TermReplay> {
    const owners = this.owners.get(id) ?? new Set<WebContents>();
    owners.add(owner);
    this.owners.set(id, owners);
    let sequence = 0;
    // Capture the replay boundary synchronously while reading the socket.
    // Renderers discard queued live chunks already included in this replay.
    const { buffer, cols, rows } = await this.request<"attached">({ type: "attach", id }, () => {
      sequence = this.sequences.get(id) ?? 0;
    });
    return { buffer, sequence, cols, rows };
  }

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    this.connecting ??= this.connectOrSpawn().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async connectOrSpawn(): Promise<net.Socket> {
    for (let attempt = 0; ; attempt++) {
      try {
        return this.wire(await this.dial());
      } catch (err) {
        if (attempt >= 40) throw err;
        if (attempt === 0) this.spawnHost((err as NodeJS.ErrnoException).code);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  private dial(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  private spawnHost(reason: string | undefined): void {
    // ECONNREFUSED means the file outlived its host; a new host can't bind
    // over it.
    if (reason === "ECONNREFUSED") fs.rmSync(this.socketPath, { force: true });
    const log = fs.openSync(this.logPath, "a");
    // The Electron binary as plain Node keeps the electron-rebuilt node-pty
    // ABI-compatible; detached so our exit (or SIGKILL) never reaches it.
    const child = spawn(process.execPath, [path.join(import.meta.dirname, "ptyHost.js"), this.socketPath], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref();
    fs.closeSync(log);
  }

  private wire(socket: net.Socket): net.Socket {
    this.socket = socket;
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString();
      let nl: number;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (line) this.handle(JSON.parse(line) as HostMessage);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      // Host gone: every terminal went with it.
      for (const id of this.owners.keys()) {
        endTermSessions(id);
        for (const cb of exitListeners) cb(id);
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send("term:exit", id, -1);
      }
      this.sequences.clear();
      this.owners.clear();
      this.pending.clear();
      this.socket = undefined;
    });
    return socket;
  }

  private handle(msg: HostMessage): void {
    if ("req" in msg) {
      const resolve = this.pending.get(msg.req);
      this.pending.delete(msg.req);
      resolve?.(msg);
      return;
    }
    if (msg.type === "foreground") {
      updateForegroundSession(msg.meta);
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("term:busy", msg.meta.id, msg.meta.busy ?? false);
      return;
    }
    if (msg.type === "cwd") {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("term:cwd", msg.id, msg.cwd);
      return;
    }
    if (msg.type === "exit") {
      endTermSessions(msg.id);
      this.owners.delete(msg.id);
      for (const cb of exitListeners) cb(msg.id);
      // Every window lists the tab, not only the ones that displayed it.
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("term:exit", msg.id, msg.code);
      return;
    }
    const owners = this.owners.get(msg.id);
    const sequence = (this.sequences.get(msg.id) ?? 0) + 1;
    this.sequences.set(msg.id, sequence);
    for (const owner of owners ?? []) {
      if (owner.isDestroyed()) { owners?.delete(owner); continue; }
      owner.send("term:data", msg.id, msg.data, sequence);
    }
  }
}

let client: PtyHostClient | undefined;
let stopLegacyDetection: (() => void) | undefined;
const exitListeners = new Set<(id: string) => void>();

function startLegacyDetection(host: PtyHostClient): () => void {
  const detector = new LegacyAgentDetector();
  let stopped = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scan = async () => {
    try {
      const { terms } = await host.request<"list">({ type: "list" });
      const changes = await detector.scan(terms);
      if (!stopped) for (const term of changes) updateForegroundSession(term);
      failed = false;
    } catch {
      // Do not log process output: it may contain environment values.
      if (!failed) console.warn("Could not inspect agents in the older terminal host.");
      failed = true;
    } finally {
      if (!stopped) timer = setTimeout(() => void scan(), 1000);
    }
  };
  void scan();
  return () => { stopped = true; clearTimeout(timer); };
}

/** Fires when a terminal's process exits (or the host goes away with it). */
export function onTermExit(cb: (id: string) => void): () => void {
  exitListeners.add(cb);
  return () => exitListeners.delete(cb);
}

export async function startPtyHost(): Promise<void> {
  client = new PtyHostClient();
  const { terms } = await client.request<"list">({ type: "list" });
  // Terminals that lived through the restart keep their ticket link and
  // session rows; only the ones that didn't get unlinked.
  for (const t of terms) if (t.issueKey) linkTermToIssue(t.id, t.issueKey);
  clearTermLinks(terms.map((t) => t.id));
  for (const term of terms) if (term.foregroundProcess) updateForegroundSession(term);
  stopLegacyDetection = startLegacyDetection(client);

  ipcMain.handle("term:create", (event, opts: TermCreateOptions = {}) => createTerm({ ...opts, windowRole: windowRoles.get(event.sender) }));
  ipcMain.handle("term:list", async (event): Promise<TermMeta[]> => {
    const { terms } = await client!.request<"list">({ type: "list" });
    return terms.filter((meta) => visibleTo(event.sender, meta));
  });
  ipcMain.handle("term:attach", (event, id: string) => client!.attach(id, event.sender));
  ipcMain.on("term:input", (_e, id: string, data: string) => client!.send({ type: "input", id, data }));
  ipcMain.on("term:resize", (_e, id: string, cols: number, rows: number) =>
    client!.send({ type: "resize", id, cols, rows }),
  );
  ipcMain.on("term:kill", (_e, id: string) => {
    endTermSessions(id);
    client!.send({ type: "kill", id });
  });
}

/** Opens a terminal (optionally running an agent) and tells every window about it. */
export async function createTerm(opts: TermCreateOptions = {}): Promise<TermMeta> {
  const spawn = spawnRequest(opts);
  const reply = await client!.request<"created">({ type: "create", spawn });
  // Hosts surviving a dev restart may predate structured agent metadata.
  const meta = { ...reply.meta, agent: spawn.agent, sessionId: spawn.sessionId, prompt: spawn.prompt };
  if (meta.issueKey) linkTermToIssue(meta.id, meta.issueKey);
  registerAgentTerm(meta);
  for (const window of BrowserWindow.getAllWindows()) if (visibleTo(window.webContents, meta)) window.webContents.send("term:created", meta);
  return meta;
}

/** Types into a terminal as one bracketed paste, then submits; agents fold a
 *  trailing newline into pasted text, so Enter has to be its own keystroke. */
export function sendToTerm(id: string, text: string): void {
  client!.send({ type: "input", id, data: `\x1b[200~${text}\x1b[201~` });
  setTimeout(() => client!.send({ type: "input", id, data: "\r" }), 200);
}

/** Packaged quit takes the shells along; in dev they stay for the restart. */
export function stopPtyHost(): void {
  stopLegacyDetection?.();
  if (app.isPackaged) client?.send({ type: "shutdown" });
}
