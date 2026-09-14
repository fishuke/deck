import type { DeckTheme } from "../shared/themes.js";
import type { DeckPlugin, ExtensionCatalog } from "../shared/extensions.js";
import type { FileEntry, LocalFile } from "../main/files.js";
import type { Agent } from "../shared/agents.js";
import type { KeybindCommand } from "../shared/keybinds.js";
import type { TermCreateOptions } from "../main/pty.js";
import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import type { ConvMessage, IndexProgress, SearchHit } from "../main/indexer.js";
import type { GithubHit, RepoDir, RepoHit } from "../main/providers.js";
import type {
  DraftComment,
  IssuePr,
  MergeMethod,
  PrActionResult,
  PrComment,
  PrDetail,
  PrStack,
  PrTimelineEvent,
  ReviewEvent,
} from "../main/github.js";
import type { GitSummary, WorkingChanges } from "../main/git.js";
import type { LinkedWorktree, RemoveResult, Worktree } from "../main/worktrees.js";
import type { InstalledVersions, ProjectRuntime } from "../main/projectRuntime.js";
import type { TermMeta, TermReplay } from "../main/pty.js";
import type { BoardCache, BoardColumnStatuses } from "../main/board/types.js";
import type { AskEvent, AskResult } from "../main/agentTurn.js";
import type { ReviewDraft, ReviewPr } from "../main/review.js";
import type { PrInbox } from "../main/prInbox.js";
import type { AgentSession } from "../main/sessions.js";
import type { DeckSettings } from "../shared/settings.js";

const api = {
  /** A menu item the user picked, as the command id the keybinds use. */
  onMenuCommand: (cb: (command: KeybindCommand) => void): (() => void) => {
    const listener = (_e: unknown, command: KeybindCommand) => cb(command);
    ipcRenderer.on("menu:command", listener);
    return () => ipcRenderer.removeListener("menu:command", listener);
  },
  onSettingsChanged: (cb: (settings: DeckSettings) => void): (() => void) => {
    const listener = (_e: unknown, settings: DeckSettings) => cb(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  extensions: {
    get: (): Promise<ExtensionCatalog> => ipcRenderer.invoke("extensions:get"),
    openFolder: (kind: "themes" | "plugins"): Promise<void> => ipcRenderer.invoke("extensions:folder", kind),
    saveTheme: (theme: unknown): Promise<DeckTheme> => ipcRenderer.invoke("themes:save", theme),
    importTheme: (): Promise<DeckTheme | null> => ipcRenderer.invoke("themes:import"),
    installPlugin: (): Promise<DeckPlugin | null> => ipcRenderer.invoke("plugins:install"),
    enablePlugin: (root: string, enabled: boolean): Promise<void> => ipcRenderer.invoke("plugins:enable", root, enabled),
    onChanged: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on("extensions:changed", listener);
      return () => ipcRenderer.removeListener("extensions:changed", listener);
    },
  },
  getSettings: (): Promise<DeckSettings> => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch: Partial<DeckSettings>): Promise<DeckSettings> =>
    ipcRenderer.invoke("settings:update", patch),
  search: {
    query: (q: string): Promise<SearchHit[]> => ipcRenderer.invoke("search:query", q),
    session: (id: string): Promise<ConvMessage[]> => ipcRenderer.invoke("search:session", id),
    repos: (q: string): Promise<RepoHit[]> => ipcRenderer.invoke("search:repos", q),
    github: (q: string): Promise<GithubHit[]> => ipcRenderer.invoke("search:github", q),
    listRepos: (): Promise<RepoDir[]> => ipcRenderer.invoke("repos:list"),
    progress: (): Promise<IndexProgress> => ipcRenderer.invoke("index:progress"),
    onProgress: (cb: (p: IndexProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: IndexProgress) => cb(p);
      ipcRenderer.on("index:progress", listener);
      return () => ipcRenderer.removeListener("index:progress", listener);
    },
  },
  gh: {
    prsForIssue: (key: string): Promise<IssuePr[]> => ipcRenderer.invoke("gh:prsForIssue", key),
    onPrsChanged: (cb: (key: string, prs: IssuePr[]) => void): (() => void) => {
      const listener = (_e: unknown, key: string, prs: IssuePr[]) => cb(key, prs);
      ipcRenderer.on("prs:changed", listener);
      return () => ipcRenderer.removeListener("prs:changed", listener);
    },
    prDetail: (repo: string, n: number): Promise<PrDetail | null> =>
      ipcRenderer.invoke("gh:prDetail", repo, n),
    prStack: (repo: string, head: string, base: string, n: number): Promise<PrStack> =>
      ipcRenderer.invoke("gh:prStack", repo, head, base, n),
    prDiff: (repo: string, n: number): Promise<string> => ipcRenderer.invoke("gh:prDiff", repo, n),
    prComments: (repo: string, n: number): Promise<PrComment[]> =>
      ipcRenderer.invoke("gh:prComments", repo, n),
    prTimeline: (repo: string, n: number): Promise<PrTimelineEvent[]> =>
      ipcRenderer.invoke("gh:prTimeline", repo, n),
    review: (
      repo: string,
      n: number,
      event: ReviewEvent,
      body: string,
      comments: DraftComment[],
    ): Promise<PrActionResult> => ipcRenderer.invoke("gh:review", repo, n, event, body, comments),
    merge: (
      repo: string,
      n: number,
      method: MergeMethod,
      issueKey?: string,
    ): Promise<PrActionResult> => ipcRenderer.invoke("gh:merge", repo, n, method, issueKey),
    setFileViewed: (prId: string, path: string, viewed: boolean): Promise<PrActionResult> =>
      ipcRenderer.invoke("gh:setFileViewed", prId, path, viewed),
    autoMerge: (repo: string, n: number, method: MergeMethod): Promise<PrActionResult> =>
      ipcRenderer.invoke("gh:autoMerge", repo, n, method),
    replyToThread: (threadId: string, body: string): Promise<PrActionResult> =>
      ipcRenderer.invoke("gh:replyToThread", threadId, body),
    setThreadResolved: (threadId: string, resolved: boolean): Promise<PrActionResult> =>
      ipcRenderer.invoke("gh:setThreadResolved", threadId, resolved),
    addComment: (repo: string, n: number, body: string): Promise<PrActionResult> =>
      ipcRenderer.invoke("gh:addComment", repo, n, body),
    fileContent: (repo: string, ref: string, path: string): Promise<string | null> =>
      ipcRenderer.invoke("gh:fileContent", repo, ref, path),
  },
  board: {
    get: (): Promise<BoardCache | undefined> => ipcRenderer.invoke("board:get"),
    columns: (): Promise<BoardColumnStatuses[]> => ipcRenderer.invoke("board:columns"),
    sync: (): Promise<BoardCache | undefined> => ipcRenderer.invoke("board:sync"),
    move: (key: string, column: string): Promise<BoardCache> =>
      ipcRenderer.invoke("board:move", key, column),
    onChanged: (cb: (b: BoardCache | undefined) => void): (() => void) => {
      const listener = (_e: unknown, b: BoardCache | undefined) => cb(b);
      ipcRenderer.on("board:changed", listener);
      return () => ipcRenderer.removeListener("board:changed", listener);
    },
    onSyncError: (cb: (message: string) => void): (() => void) => {
      const listener = (_e: unknown, message: string) => cb(message);
      ipcRenderer.on("board:error", listener);
      return () => ipcRenderer.removeListener("board:error", listener);
    },
  },
  files: {
    list: (root: string, directory?: string): Promise<FileEntry[]> => ipcRenderer.invoke("files:list", root, directory),
    read: (root: string, file: string): Promise<LocalFile> => ipcRenderer.invoke("files:read", root, file),
    save: (root: string, file: string, contents: LocalFile): Promise<LocalFile> => ipcRenderer.invoke("files:save", root, file, contents),
  },
  project: {
    /** Runtime the folder's project runs on, or null when it has no marker. */
    runtime: (cwd: string): Promise<ProjectRuntime | null> => ipcRenderer.invoke("project:runtime", cwd),
    /** Locally installed versions of that runtime, for the version menu. */
    versions: (cwd: string): Promise<InstalledVersions | null> => ipcRenderer.invoke("project:versions", cwd),
  },
  git: {
    summary: (cwd: string): Promise<GitSummary | null> => ipcRenderer.invoke("git:summary", cwd),
    changes: (cwd: string): Promise<WorkingChanges> => ipcRenderer.invoke("git:changes", cwd),
    branches: (cwd: string): Promise<string[]> => ipcRenderer.invoke("git:branches", cwd),
  },
  sharing: {
    summary: (): Promise<{ shared: number; total: number }> => ipcRenderer.invoke("sharing:summary"),
    setCurrentProject: (cwd?: string): Promise<void> => ipcRenderer.invoke("sharing:current", cwd),
  },
  worktrees: {
    /** The linked worktree the directory sits in, or null in a main checkout. */
    at: (cwd: string): Promise<Worktree | null> => ipcRenderer.invoke("worktrees:at", cwd),
    /** Every linked worktree under the repo roots, biggest first. */
    list: (): Promise<LinkedWorktree[]> => ipcRenderer.invoke("worktrees:list"),
    remove: (worktree: string, deleteBranch = false): Promise<RemoveResult> =>
      ipcRenderer.invoke("worktrees:remove", worktree, deleteBranch),
  },
  sessions: {
    list: (): Promise<AgentSession[]> => ipcRenderer.invoke("sessions:list"),
    remove: (id: string): Promise<void> => ipcRenderer.invoke("sessions:remove", id),
    onChanged: (cb: (sessions: AgentSession[]) => void): (() => void) => {
      const listener = (_e: unknown, sessions: AgentSession[]) => cb(sessions);
      ipcRenderer.on("sessions:changed", listener);
      return () => ipcRenderer.removeListener("sessions:changed", listener);
    },
    hooksInstalled: (agent: Agent = "claude"): Promise<boolean> => ipcRenderer.invoke("hooks:installed", agent),
    installHooks: (agent: Agent = "claude"): Promise<{ installed: boolean; path: string }> =>
      ipcRenderer.invoke("hooks:install", agent),
  },
  ask: {
    /** One turn of the deck conversation; text also streams via onDelta. */
    send: (question: string, agent?: Agent, model?: string): Promise<AskResult> => ipcRenderer.invoke("ask:send", question, agent, model),
    reset: (): Promise<void> => ipcRenderer.invoke("ask:reset"),
    /** Answer text as it streams, and the deck tools the assistant calls. */
    onEvent: (cb: (event: AskEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: AskEvent) => cb(event);
      ipcRenderer.on("ask:event", listener);
      return () => ipcRenderer.removeListener("ask:event", listener);
    },
  },
  review: {
    /** One turn of a PR's review assistant; text streams via onEvent with the PR key. */
    send: (pr: ReviewPr, question: string, agent?: Agent): Promise<AskResult> => ipcRenderer.invoke("review:send", pr, question, agent),
    reset: (repo: string, number: number): Promise<void> => ipcRenderer.invoke("review:reset", repo, number),
    onEvent: (cb: (key: string, event: AskEvent) => void): (() => void) => {
      const listener = (_e: unknown, key: string, event: AskEvent) => cb(key, event);
      ipcRenderer.on("review:event", listener);
      return () => ipcRenderer.removeListener("review:event", listener);
    },
    drafts: (repo: string, number: number): Promise<ReviewDraft[]> => ipcRenderer.invoke("review:drafts", repo, number),
    addDraft: (repo: string, number: number, draft: DraftComment): Promise<ReviewDraft[]> => ipcRenderer.invoke("review:addDraft", repo, number, draft),
    removeDraft: (repo: string, number: number, id: number): Promise<ReviewDraft[]> => ipcRenderer.invoke("review:removeDraft", repo, number, id),
    clearDrafts: (repo: string, number: number): Promise<ReviewDraft[]> => ipcRenderer.invoke("review:clearDrafts", repo, number),
    onDrafts: (cb: (repo: string, number: number, drafts: ReviewDraft[]) => void): (() => void) => {
      const listener = (_e: unknown, repo: string, number: number, drafts: ReviewDraft[]) => cb(repo, number, drafts);
      ipcRenderer.on("review:drafts", listener);
      return () => ipcRenderer.removeListener("review:drafts", listener);
    },
  },
  hotkey: {
    /** The summon accelerator deck actually holds, empty when it is disabled
     *  or another app owns it. */
    registered: (): Promise<string> => ipcRenderer.invoke("hotkey:registered"),
    /** The summon hotkey was pressed, whether that showed or hid a window. */
    onSummoned: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on("hotkey:summoned", listener);
      return () => ipcRenderer.removeListener("hotkey:summoned", listener);
    },
  },
  window: {
    focus: (): Promise<void> => ipcRenderer.invoke("window:focus"),
    /** The window became key, e.g. after the summon hotkey. */
    onFocused: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on("window:focused", listener);
      return () => ipcRenderer.removeListener("window:focused", listener);
    },
    /** Opens another regular Deck window. */
    open: (): Promise<void> => ipcRenderer.invoke("window:new"),
    setFullScreen: (on: boolean): Promise<void> => ipcRenderer.invoke("window:fullscreen", on),
    isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("window:isFullscreen"),
    /** Page zoom as a Chromium level: 0 is 100% and each level scales by 1.2.
     *  Chromium keeps it per origin, so every Deck window follows. */
    zoomLevel: (): number => webFrame.getZoomLevel(),
    setZoomLevel: (level: number): void => webFrame.setZoomLevel(level),
  },
  inbox: {
    get: (): Promise<PrInbox | undefined> => ipcRenderer.invoke("inbox:get"),
    refresh: (): Promise<PrInbox | undefined> => ipcRenderer.invoke("inbox:refresh"),
    onChanged: (cb: (inbox: PrInbox | undefined) => void): (() => void) => {
      const listener = (_e: unknown, inbox: PrInbox | undefined) => cb(inbox);
      ipcRenderer.on("inbox:changed", listener);
      return () => ipcRenderer.removeListener("inbox:changed", listener);
    },
  },
  term: {
    onCreated: (cb: (meta: TermMeta) => void): (() => void) => {
      const listener = (_e: unknown, meta: TermMeta) => cb(meta);
      ipcRenderer.on("term:created", listener);
      return () => ipcRenderer.removeListener("term:created", listener);
    },
    create: (opts?: TermCreateOptions): Promise<TermMeta> =>
      ipcRenderer.invoke("term:create", opts),
    list: (): Promise<TermMeta[]> => ipcRenderer.invoke("term:list"),
    /** Replays the terminal's recent output to this window, then streams live. */
    attach: (id: string): Promise<TermReplay> => ipcRenderer.invoke("term:attach", id),
    input: (id: string, data: string): void => ipcRenderer.send("term:input", id, data),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send("term:resize", id, cols, rows),
    kill: (id: string): void => ipcRenderer.send("term:kill", id),
    moveToWorkspace: (id: string, workspace: string): void => ipcRenderer.send("term:workspace", id, workspace),
    /** Absolute path of a file dragged in from Finder; only the preload may read it. */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    onData: (cb: (id: string, data: string, sequence: number) => void): (() => void) => {
      const listener = (_e: unknown, id: string, data: string, sequence: number) => cb(id, data, sequence);
      ipcRenderer.on("term:data", listener);
      return () => ipcRenderer.removeListener("term:data", listener);
    },
    /** Whether a program other than the shell holds the terminal. */
    onBusy: (cb: (id: string, busy: boolean) => void): (() => void) => {
      const listener = (_e: unknown, id: string, busy: boolean) => cb(id, busy);
      ipcRenderer.on("term:busy", listener);
      return () => ipcRenderer.removeListener("term:busy", listener);
    },
    /** The shell's working directory, whenever a cd moves it. */
    onCwd: (cb: (id: string, cwd: string) => void): (() => void) => {
      const listener = (_e: unknown, id: string, cwd: string) => cb(id, cwd);
      ipcRenderer.on("term:cwd", listener);
      return () => ipcRenderer.removeListener("term:cwd", listener);
    },
    onExit: (cb: (id: string, code: number) => void): (() => void) => {
      const listener = (_e: unknown, id: string, code: number) => cb(id, code);
      ipcRenderer.on("term:exit", listener);
      return () => ipcRenderer.removeListener("term:exit", listener);
    },
  },
};

export type DeckApi = typeof api;

contextBridge.exposeInMainWorld("deck", api);
