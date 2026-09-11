// Keep first: names the channel before any module reads userData.
import "./devChannel.js";
import {
  startExtensions,
  stopExtensions,
  onExtensionsChanged,
  extensionCatalog,
  saveTheme,
  importTheme,
  installPlugin,
  enablePlugin,
  openExtensionFolder,
} from "./extensions.js";
import {
  listFiles,
  readLocalFile,
  saveLocalFile,
  type LocalFile,
} from "./files.js";
import type { Agent } from "../shared/agents.js";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  Tray,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import appIcon from "../../resources/icon.png?asset";
import trayIcon from "../../resources/trayTemplate.png?asset";
import trayIcon2x from "../../resources/trayTemplate@2x.png?asset";
import type { DeckSettings } from "../shared/settings.js";
import { askDeck, resetAsk } from "./ask.js";
import type { AskEvent } from "./agentTurn.js";
import { startAutoFix } from "./autofix.js";
import {
  getPrInbox,
  onPrInboxChanged,
  refreshPrInbox,
  startPrInbox,
  stopPrInbox,
} from "./prInbox.js";
import { hooksInstalled, installHooks } from "./hooksInstall.js";
import {
  getIndexProgress,
  onIndexProgress,
  searchConversations,
  sessionMessages,
  startIndexer,
} from "./indexer.js";
import { sharingSummary, setCurrentProject } from "./sharing.js";
import { installAppMenu } from "./menu.js";
import { listRepos, searchGithub, searchRepos } from "./providers.js";
import {
  setWindowRole,
  startPtyHost,
  stopPtyHost,
  windowRoleOf,
} from "./pty.js";
import { startServer, stopServer } from "./server.js";
import {
  addDrafts,
  askReview,
  clearDrafts,
  getDrafts,
  onDraftsChanged,
  removeDraft,
  resetReview,
  type ReviewPr,
} from "./review.js";
import {
  mergePr,
  addPrComment,
  enableAutoMerge,
  fileContent,
  prComments,
  prDetail,
  prStack,
  prDiff,
  prTimeline,
  replyToThread,
  setPrFileViewed,
  setThreadResolved,
  submitPrReview,
  type DraftComment,
  type MergeMethod,
  type ReviewEvent,
} from "./github.js";
import { installedVersions, projectRuntime } from "./projectRuntime.js";
import { gitBranches, gitSummary, repoRoot, workingChanges } from "./git.js";
import { invalidateSweep, listLinkedWorktrees, pruneWorktrees, removeWorktree, worktreeAt } from "./worktrees.js";
import { onPrsChanged, prsForIssue, startPrWarmer } from "./issuePrs.js";
import {
  afterPrMerged,
  fetchBoardColumns,
  getBoardCache,
  moveIssue,
  onBoardChanged,
  startBoardSync,
  syncBoard,
} from "./board/board.js";
import { listSessions, onSessionsChanged, removeSession } from "./sessions.js";
import { getSettings, updateSettings } from "./settings.js";

/** Which action brought a window up. Mapped to a window role by windowMode. */
type EntryPoint = "hotkey" | "manual";
type WindowRole = "main" | "panel";

const wins = new Map<WindowRole, BrowserWindow>();
/** Windows currently shown as a quake panel; they hide again on blur. */
const quakeWins = new WeakSet<BrowserWindow>();
/** Regular bounds of a window while it is docked as a quake panel, so a Dock
 *  or tray open brings back a normal window instead of the panel. */
const normalBounds = new WeakMap<BrowserWindow, Electron.Rectangle>();
/** Height the user dragged the quake panel to, kept until the app quits so a
 *  resize survives hide/summon but every launch starts from the setting. */
let quakeHeightRatio: number | undefined;
let tray: Tray | undefined;
let registeredHotkey: string | undefined;
/** How far a new window sits from the one it was opened from, like the Mac title-bar cascade. */
const CASCADE_OFFSET = 24;

function roleFor(entry: EntryPoint): WindowRole {
  return entry === "hotkey" && getSettings().windowMode === "panel"
    ? "panel"
    : "main";
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows())
    w.webContents.send(channel, ...args);
}

// Surface main-process crashes instead of dying silently.
function logFatal(kind: string, err: unknown): void {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "deck-main.log"),
      `${new Date().toISOString()} ${kind}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
  } catch {
    // nothing left to do
  }
}
process.on("uncaughtException", (err) => logFatal("uncaught", err));
process.on("unhandledRejection", (err) => logFatal("unhandled-rejection", err));

// Single instance: a second `deck` just summons the existing window. Dev-mode
// watch restarts need the opposite — the NEW instance must win, because the
// tray keeps the old one alive through electron-vite's terminate signal.
if (app.isPackaged) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else app.on("second-instance", () => showWindow(roleFor("manual")));
} else {
  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());
  const pidFile = path.join(app.getPath("userData"), "dev.pid");
  try {
    const old = Number(fs.readFileSync(pidFile, "utf8"));
    if (old && old !== process.pid) process.kill(old, "SIGKILL");
  } catch {
    // no previous instance
  }
  fs.writeFileSync(pidFile, String(process.pid));
}

function createWindow(role: WindowRole, from?: BrowserWindow): BrowserWindow {
  // A window opened from another one cascades down and right of it like any
  // Mac app, and starts over at the top-left of its screen when out of room.
  let bounds: Partial<Electron.Rectangle> = {};
  if (from) {
    const origin =
      (quakeWins.has(from) && normalBounds.get(from)) || from.getBounds();
    const { workArea } = screen.getDisplayMatching(origin);
    const fits =
      origin.x + CASCADE_OFFSET + origin.width <= workArea.x + workArea.width &&
      origin.y + CASCADE_OFFSET + origin.height <= workArea.y + workArea.height;
    bounds = fits
      ? {
          ...origin,
          x: origin.x + CASCADE_OFFSET,
          y: origin.y + CASCADE_OFFSET,
        }
      : { ...origin, x: workArea.x, y: workArea.y };
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#0c0c0e",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      // ESM preload scripts require an unsandboxed renderer.
      sandbox: false,
    },
  });

  wins.set(role, win);
  setWindowRole(win.webContents, role);
  win.on("ready-to-show", () => win.show());
  win.on("blur", () => {
    if (quakeWins.has(win) && getSettings().summonHideOnBlur) hideWindow(win);
  });
  // The role entry follows focus, so the hotkey and tray target the window
  // last used, and a closed entry hands over to a surviving window of its role.
  // Unhiding the app does not always fire a DOM focus event, so the renderer is
  // told to put the caret back in the terminal from here.
  win.on("focus", () => {
    wins.set(role, win);
    win.webContents.send("window:focused");
  });
  win.on("closed", () => {
    if (wins.get(role) !== win) return;
    const sibling = BrowserWindow.getAllWindows().find(
      (other) => windowRoleOf(other.webContents) === role,
    );
    if (sibling) wins.set(role, sibling);
    else wins.delete(role);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

/** Shows the role's window either docked as a quake panel (hotkey) or as a
 *  regular window (Dock, tray, second launch), like Warp's Dock click never
 *  opening its dedicated hotkey window. */
function showWindow(role: WindowRole, quake = false): void {
  const w = wins.get(role) ?? createWindow(role);
  if (quake) {
    dockToTop(w);
    quakeWins.add(w);
  } else if (quakeWins.has(w)) {
    quakeWins.delete(w);
    const bounds = normalBounds.get(w);
    if (bounds) w.setBounds(bounds);
  }
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  app.focus({ steal: true });
  w.webContents.focus();
}

function hideWindow(w: BrowserWindow): void {
  if (quakeWins.has(w)) {
    const bounds = w.getBounds();
    quakeHeightRatio =
      bounds.height / screen.getDisplayMatching(bounds).workArea.height;
  }
  quakeWins.delete(w);
  w.hide();
  // Only leave the app when no other deck window stays visible.
  if (BrowserWindow.getAllWindows().every((other) => !other.isVisible()))
    app.hide();
}

/** Warp-style quake panel: full width, docked to the top of the screen the
 *  cursor is on. The window itself persists, so it reopens where you left. */
function dockToTop(w: BrowserWindow): void {
  if (!quakeWins.has(w)) normalBounds.set(w, w.getBounds());
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  const ratio = quakeHeightRatio ?? getSettings().summonHeightRatio;
  w.setBounds({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: Math.round(workArea.height * Math.min(Math.max(ratio, 0.2), 1)),
  });
}

function toggleWindow(entry: EntryPoint): void {
  const role = roleFor(entry);
  const win = wins.get(role);
  if (win?.isVisible() && win.isFocused()) {
    hideWindow(win);
  } else {
    showWindow(role, entry === "hotkey" && getSettings().summonDockToTop);
  }
}

/** (Re)registers the summon hotkey from settings; unregisters when disabled. */
function applyHotkey(): void {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = undefined;
  }
  const { summonHotkey, summonHotkeyEnabled } = getSettings();
  if (!summonHotkeyEnabled) return;
  // Onboarding waits for the press to confirm the hotkey reaches deck at all.
  const summon = () => {
    broadcast("hotkey:summoned");
    toggleWindow("hotkey");
  };
  // Electron throws on a malformed accelerator; leaving it unregistered lets
  // the settings update through and shows up as a conflict in onboarding.
  try {
    if (globalShortcut.register(summonHotkey, summon)) registeredHotkey = summonHotkey;
  } catch {
    // nothing to register
  }
}

/** Accessory apps have no Dock tile and are skipped by Cmd-Tab, yet still
 *  show windows and take focus when summoned. */
function applyDockVisibility(): void {
  if (!app.dock) return;
  if (getSettings().hideFromDock) app.dock.hide();
  else if (!app.dock.isVisible()) app.dock.show();
}

function createTray(): void {
  // Template images are tinted by macOS to match the menu bar theme. The @2x
  // file is attached explicitly so Retina bars get the sharp version.
  const icon = nativeImage.createFromPath(trayIcon);
  icon.addRepresentation({
    scaleFactor: 2,
    dataURL: nativeImage.createFromPath(trayIcon2x).toDataURL(),
  });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Deck");
  tray.on("click", () => toggleWindow("manual"));
}

app.whenReady().then(async () => {
  app.dock?.setIcon(nativeImage.createFromPath(appIcon));
  await startPtyHost();
  startServer();
  startIndexer();
  startExtensions();
  onExtensionsChanged(() => broadcast("extensions:changed"));
  ipcMain.handle("extensions:get", () => extensionCatalog());
  ipcMain.handle("extensions:folder", (_e, kind: "themes" | "plugins") =>
    openExtensionFolder(kind),
  );
  ipcMain.handle("themes:save", (_e, theme: unknown) => saveTheme(theme));
  ipcMain.handle("themes:import", () => importTheme());
  ipcMain.handle("plugins:install", () => installPlugin());
  ipcMain.handle("plugins:enable", (_e, root: string, enabled: boolean) =>
    enablePlugin(root, enabled),
  );
  onIndexProgress((p) => broadcast("index:progress", p));
  ipcMain.handle("index:progress", () => getIndexProgress());
  ipcMain.handle("search:query", (_e, q: string) => searchConversations(q));
  ipcMain.handle("search:session", (_e, id: string) => sessionMessages(id));
  ipcMain.handle("search:repos", (_e, q: string) => searchRepos(q));
  ipcMain.handle("search:github", (_e, q: string) => searchGithub(q));
  ipcMain.handle("repos:list", () => listRepos());
  onSessionsChanged(() => broadcast("sessions:changed", listSessions()));
  ipcMain.handle("sessions:list", () => listSessions());
  ipcMain.handle("sharing:summary", () => sharingSummary());
  ipcMain.handle("sharing:current", async (_e, cwd?: string) =>
    setCurrentProject(cwd ? await repoRoot(cwd) : undefined));
  ipcMain.handle("sessions:remove", (_e, id: string) => removeSession(id));
  ipcMain.handle("files:list", (_e, root: string, directory?: string) =>
    listFiles(root, directory),
  );
  ipcMain.handle("files:read", (_e, root: string, file: string) =>
    readLocalFile(root, file),
  );
  ipcMain.handle(
    "files:save",
    (_e, root: string, file: string, contents: LocalFile) =>
      saveLocalFile(root, file, contents),
  );
  ipcMain.handle("project:runtime", (_e, cwd: string) => projectRuntime(cwd));
  ipcMain.handle("project:versions", (_e, cwd: string) => installedVersions(cwd));
  ipcMain.handle("git:branches", (_e, cwd: string) => gitBranches(cwd));
  ipcMain.handle("git:summary", (_e, cwd: string) => gitSummary(cwd));
  ipcMain.handle("git:changes", (_e, cwd: string) => workingChanges(cwd));
  ipcMain.handle("worktrees:at", (_e, cwd: string) => worktreeAt(cwd));
  ipcMain.handle("worktrees:list", () => listLinkedWorktrees());
  ipcMain.handle("worktrees:remove", async (_e, worktree: string, deleteBranch: boolean) => {
    const result = await removeWorktree(worktree, deleteBranch);
    if (result.removed) invalidateSweep();
    return result;
  });
  ipcMain.handle(
    "ask:send",
    (e, question: string, agent?: Agent, model?: string) =>
      askDeck(
        question,
        (event: AskEvent) => {
          if (!e.sender.isDestroyed()) e.sender.send("ask:event", event);
        },
        agent,
        model,
      ),
  );
  ipcMain.handle("ask:reset", () => resetAsk());
  ipcMain.handle(
    "review:send",
    (e, pr: ReviewPr, question: string, agent?: Agent) =>
      askReview(
        pr,
        question,
        (event: AskEvent) => {
          if (!e.sender.isDestroyed())
            e.sender.send("review:event", `${pr.repo}#${pr.number}`, event);
        },
        agent,
      ),
  );
  ipcMain.handle("review:reset", (_e, repo: string, number: number) =>
    resetReview(repo, number),
  );
  ipcMain.handle("review:drafts", (_e, repo: string, number: number) =>
    getDrafts(repo, number),
  );
  ipcMain.handle(
    "review:addDraft",
    (_e, repo: string, number: number, draft: DraftComment) =>
      addDrafts(repo, number, [draft]),
  );
  ipcMain.handle(
    "review:removeDraft",
    (_e, repo: string, number: number, id: number) =>
      removeDraft(repo, number, id),
  );
  ipcMain.handle("review:clearDrafts", (_e, repo: string, number: number) =>
    clearDrafts(repo, number),
  );
  onDraftsChanged((repo, number, drafts) =>
    broadcast("review:drafts", repo, number, drafts),
  );
  startAutoFix();
  startPrInbox();
  // Registrations for worktrees whose directory is long gone are pure noise
  // in every `worktree list`, so they go on startup.
  void pruneWorktrees();
  onPrInboxChanged((inbox) => broadcast("inbox:changed", inbox));
  ipcMain.handle("inbox:get", () => getPrInbox());
  ipcMain.handle("window:focus", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !win.isVisible()) return;
    win.focus();
    app.focus({ steal: true });
    win.webContents.focus();
  });
  ipcMain.handle("window:fullscreen", (e, on: boolean) =>
    BrowserWindow.fromWebContents(e.sender)?.setFullScreen(on),
  );
  ipcMain.handle(
    "window:isFullscreen",
    (e) => BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false,
  );
  ipcMain.handle("window:new", (e) => {
    createWindow("main", BrowserWindow.fromWebContents(e.sender) ?? undefined);
  });
  ipcMain.handle("inbox:refresh", () =>
    refreshPrInbox().catch(() => getPrInbox()),
  );
  startPrWarmer();
  onPrsChanged((key, prs) => broadcast("prs:changed", key, prs));
  startBoardSync();
  onBoardChanged((b) => broadcast("board:changed", b));
  ipcMain.handle("board:get", () => getBoardCache());
  ipcMain.handle("board:columns", () => fetchBoardColumns());
  ipcMain.handle("board:move", (_e, key: string, column: string) =>
    moveIssue(key, column),
  );
  ipcMain.handle("gh:prsForIssue", (_e, key: string) =>
    prsForIssue(
      key,
      getBoardCache()?.issues.find((i) => i.key === key),
    ),
  );
  ipcMain.handle("gh:prDetail", (_e, repo: string, n: number) =>
    prDetail(repo, n),
  );
  ipcMain.handle(
    "gh:prStack",
    (_e, repo: string, head: string, base: string, n: number) =>
      prStack(repo, head, base, n),
  );
  ipcMain.handle("gh:prDiff", (_e, repo: string, n: number) => prDiff(repo, n));
  ipcMain.handle("gh:prComments", (_e, repo: string, n: number) =>
    prComments(repo, n),
  );
  ipcMain.handle("gh:prTimeline", (_e, repo: string, n: number) =>
    prTimeline(repo, n),
  );
  ipcMain.handle(
    "gh:review",
    (
      _e,
      repo: string,
      n: number,
      event: ReviewEvent,
      body: string,
      comments: DraftComment[],
    ) => submitPrReview(repo, n, event, body, comments),
  );
  ipcMain.handle(
    "gh:merge",
    async (
      _e,
      repo: string,
      n: number,
      method: MergeMethod,
      issueKey?: string,
    ) => {
      const result = await mergePr(repo, n, method);
      if (!result.ok || !issueKey) return result;
      try {
        await afterPrMerged(issueKey);
        return result;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Merged, but moving ${issueKey} failed: ${reason}`,
        };
      }
    },
  );
  ipcMain.handle(
    "gh:setFileViewed",
    (_e, prId: string, path: string, viewed: boolean) =>
      setPrFileViewed(prId, path, viewed),
  );
  ipcMain.handle(
    "gh:autoMerge",
    (_e, repo: string, n: number, method: MergeMethod) =>
      enableAutoMerge(repo, n, method),
  );
  ipcMain.handle("gh:replyToThread", (_e, threadId: string, body: string) =>
    replyToThread(threadId, body),
  );
  ipcMain.handle(
    "gh:setThreadResolved",
    (_e, threadId: string, resolved: boolean) =>
      setThreadResolved(threadId, resolved),
  );
  ipcMain.handle("gh:addComment", (_e, repo: string, n: number, body: string) =>
    addPrComment(repo, n, body),
  );
  ipcMain.handle(
    "gh:fileContent",
    (_e, repo: string, ref: string, path: string) =>
      fileContent(repo, ref, path),
  );
  ipcMain.handle("board:sync", () => syncBoard().catch(() => getBoardCache()));
  // An existing install predates events added since; appending is a no-op
  // when nothing is missing, and consent was given by the original install.
  for (const agent of ["claude", "codex"] as const)
    if (hooksInstalled(agent)) installHooks(agent);
  ipcMain.handle("hooks:installed", (_e, agent: Agent = "claude") =>
    hooksInstalled(agent),
  );
  ipcMain.handle("hooks:install", (_e, agent: Agent = "claude") =>
    installHooks(agent),
  );
  // Empty when the accelerator is disabled or another app already owns it.
  ipcMain.handle("hotkey:registered", () => registeredHotkey ?? "");
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_e, patch: Partial<DeckSettings>) => {
    const next = updateSettings(patch);
    broadcast("settings:changed", next);
    if ("summonHotkey" in patch || "summonHotkeyEnabled" in patch)
      applyHotkey();
    if ("summonHeightRatio" in patch) quakeHeightRatio = undefined;
    if ("hideFromDock" in patch) applyDockVisibility();
    if ("keybinds" in patch) installAppMenu();
    return next;
  });

  installAppMenu();
  createWindow("main");
  createTray();
  applyHotkey();
  applyDockVisibility();

  app.on("activate", () => showWindow(roleFor("manual")));
});

// deck lives in the tray; closing the window must not quit the app.
app.on("window-all-closed", () => {});

app.on("will-quit", () => {
  // An instance that aborts before ready (e.g. a dev restart race) must not
  // touch globalShortcut — Electron throws pre-ready.
  if (app.isReady()) globalShortcut.unregisterAll();
  stopServer();
  stopPrInbox();
  stopExtensions();
  stopPtyHost();
});
