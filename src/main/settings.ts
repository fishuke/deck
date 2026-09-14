import { defaultSettings, type BoardSettings, type DeckSettings, type OnMergeSettings } from "../shared/settings.js";
import { kvGet, kvSet } from "./db.js";

const KEY = "settings";

/** Board behaviour used to live inside the Jira block, before the tracker
 *  became pluggable. Lift those fields into `board` for settings saved then. */
function legacyBoard(stored: Partial<DeckSettings>): Partial<BoardSettings> {
  const jira = (stored.jira ?? {}) as Partial<Omit<BoardSettings, "onMerge">> & { onMerge?: Omit<OnMergeSettings, "mode"> & { mode?: string } };
  const { rejectedPattern, doneWindowDays, reviewColumns, onMerge } = jira;
  const board: Partial<BoardSettings> = { rejectedPattern, doneWindowDays, reviewColumns };
  if (onMerge) board.onMerge = { ...onMerge, mode: onMerge.mode === "jira" ? "remote" : "local" };
  return Object.fromEntries(Object.entries(board).filter(([, v]) => v !== undefined));
}

export function getSettings(): DeckSettings {
  const stored = kvGet<Partial<DeckSettings>>(KEY) ?? {};
  // The former "per-entry" mode (a third window for the tray) folded into "panel".
  if ((stored.windowMode as string) === "per-entry") stored.windowMode = "panel";
  // Own tabs used to be a flag on top of "panel"; it is a window mode of its own now.
  if (stored.windowMode === "panel" && (stored as { hotkeyOwnTabs?: boolean }).hotkeyOwnTabs)
    stored.windowMode = "panel-own-tabs";
  // Nested groups gain fields over time; settings saved before a field
  // existed must still pick up its default.
  const board = { ...defaultSettings.board, ...legacyBoard(stored), ...stored.board };
  return {
    ...defaultSettings,
    ...stored,
    // Settings saved before onboarding existed belong to an install that is
    // already set up; only an empty profile gets the first-run flow.
    onboarded: stored.onboarded ?? Object.keys(stored).length > 0,
    // Narrowing the queue to a board column was all a review column could do
    // before the source became a choice, so a profile that set one meant the
    // board all along.
    reviewSource: stored.reviewSource ?? (board.reviewColumns.length > 0 ? "board" : "github"),
    board: { ...board, onMerge: { ...defaultSettings.board.onMerge, ...board.onMerge } },
    jira: { ...defaultSettings.jira, ...stored.jira },
    linear: { ...defaultSettings.linear, ...stored.linear },
    githubProjects: { ...defaultSettings.githubProjects, ...stored.githubProjects },
    github: { ...defaultSettings.github, ...stored.github },
    agentSharing: { ...defaultSettings.agentSharing, ...stored.agentSharing },
    autoFix: { ...defaultSettings.autoFix, ...stored.autoFix },
    newTerminalCwd: { ...defaultSettings.newTerminalCwd, ...stored.newTerminalCwd },
    terminalAppearance: { ...defaultSettings.terminalAppearance, ...stored.terminalAppearance },
  };
}

export function updateSettings(patch: Partial<DeckSettings>): DeckSettings {
  const next = { ...getSettings(), ...patch };
  kvSet(KEY, next);
  return next;
}
