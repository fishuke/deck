import {
  defaultSettings,
  defaultWorkspaceSettings,
  legacyWorkspaceId,
  workspaceKeys,
  type BoardSettings,
  type DeckSettings,
  type OnMergeSettings,
  type Workspace,
  type WorkspaceSettings,
} from "../shared/settings.js";
import { kvGet, kvSet } from "./db.js";

const KEY = "settings";

// What is stored: deck's own settings plus the workspaces. The tracker,
// GitHub and folder settings live inside each workspace; getSettings()
// mirrors the active one onto the flat DeckSettings shape the rest of deck
// reads, and updateSettings() writes those fields back into it.
type Stored = Partial<Omit<DeckSettings, keyof WorkspaceSettings>> & Partial<WorkspaceSettings>;

/** Board behaviour used to live inside the Jira block, before the tracker
 *  became pluggable. Lift those fields into `board` for settings saved then. */
function legacyBoard(stored: Partial<WorkspaceSettings>): Partial<BoardSettings> {
  const jira = (stored.jira ?? {}) as Partial<Omit<BoardSettings, "onMerge">> & { onMerge?: Omit<OnMergeSettings, "mode"> & { mode?: string } };
  const { rejectedPattern, doneWindowDays, reviewColumns, onMerge } = jira;
  const board: Partial<BoardSettings> = { rejectedPattern, doneWindowDays, reviewColumns };
  if (onMerge) board.onMerge = { ...onMerge, mode: onMerge.mode === "jira" ? "remote" : "local" };
  return Object.fromEntries(Object.entries(board).filter(([, v]) => v !== undefined));
}

/** Nested groups gain fields over time; a workspace saved before a field
 *  existed must still pick up its default. */
function withDefaults(stored: Partial<Workspace>): Workspace {
  const board = { ...defaultWorkspaceSettings.board, ...legacyBoard(stored), ...stored.board };
  return {
    ...defaultWorkspaceSettings,
    id: stored.id ?? legacyWorkspaceId,
    name: stored.name ?? "Default",
    ...stored,
    // Narrowing the queue to a board column was all a review column could do
    // before the source became a choice, so a profile that set one meant the
    // board all along.
    reviewSource: stored.reviewSource ?? (board.reviewColumns.length > 0 ? "board" : "github"),
    board: { ...board, onMerge: { ...defaultWorkspaceSettings.board.onMerge, ...board.onMerge } },
    jira: { ...defaultWorkspaceSettings.jira, ...stored.jira },
    linear: { ...defaultWorkspaceSettings.linear, ...stored.linear },
    githubProjects: { ...defaultWorkspaceSettings.githubProjects, ...stored.githubProjects },
    github: { ...defaultWorkspaceSettings.github, ...stored.github },
  };
}

/** Before workspaces existed the tracker and GitHub settings sat at the top
 *  level; that profile becomes the one workspace, named after its owner. */
function storedWorkspaces(stored: Stored): Partial<Workspace>[] {
  if (stored.workspaces?.length) return stored.workspaces;
  const flat = Object.fromEntries(workspaceKeys.filter((key) => key in stored).map((key) => [key, stored[key]]));
  return [{ id: legacyWorkspaceId, name: stored.github?.owner || "Default", ...flat }];
}

function workspaceFields(workspace: Workspace): WorkspaceSettings {
  return Object.fromEntries(workspaceKeys.map((key) => [key, workspace[key]])) as unknown as WorkspaceSettings;
}

export function getSettings(): DeckSettings {
  const stored = kvGet<Stored>(KEY) ?? {};
  // The former "per-entry" mode (a third window for the tray) folded into "panel".
  if ((stored.windowMode as string) === "per-entry") stored.windowMode = "panel";
  // Own tabs used to be a flag on top of "panel"; it is a window mode of its own now.
  if (stored.windowMode === "panel" && (stored as { hotkeyOwnTabs?: boolean }).hotkeyOwnTabs)
    stored.windowMode = "panel-own-tabs";
  const workspaces = storedWorkspaces(stored).map(withDefaults);
  const active = workspaces.find((w) => w.id === stored.activeWorkspace) ?? workspaces[0];
  return {
    ...defaultSettings,
    ...stored,
    // Settings saved before onboarding existed belong to an install that is
    // already set up; only an empty profile gets the first-run flow.
    onboarded: stored.onboarded ?? Object.keys(stored).length > 0,
    agentSharing: { ...defaultSettings.agentSharing, ...stored.agentSharing },
    autoFix: { ...defaultSettings.autoFix, ...stored.autoFix },
    newTerminalCwd: { ...defaultSettings.newTerminalCwd, ...stored.newTerminalCwd },
    terminalAppearance: { ...defaultSettings.terminalAppearance, ...stored.terminalAppearance },
    experiments: { ...defaultSettings.experiments, ...stored.experiments },
    ...workspaceFields(active),
    workspaces,
    activeWorkspace: active.id,
  };
}

/** Applies a patch: workspace fields go into the active workspace, unless the
 *  patch replaces the workspace list itself; everything else is global. */
export function updateSettings(patch: Partial<DeckSettings>): DeckSettings {
  const current = getSettings();
  const next: Stored = { ...current, ...patch };
  const scoped = Object.fromEntries(workspaceKeys.filter((key) => key in patch).map((key) => [key, patch[key]]));
  const workspaces = (patch.workspaces ?? current.workspaces).map((w) => (w.id === current.activeWorkspace ? { ...w, ...scoped } : w));
  for (const key of workspaceKeys) delete next[key];
  kvSet(KEY, { ...next, workspaces, activeWorkspace: patch.activeWorkspace ?? current.activeWorkspace });
  return getSettings();
}
