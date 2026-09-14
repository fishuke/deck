import type { Keybinds } from "./keybinds.js";
import type { Agent } from "./agents.js";
import type { TerminalAppearanceSettings } from "./terminal.js";

// Settings shape shared between main and renderer. Everything user-tunable
// lives here — deck ships no hardcoded personal or company config.

/** Which issue tracker the board mirrors. Each is an adapter behind the same
 *  board interface; only the connection block for the chosen one is used. */
export type BoardProviderKind = "jira" | "linear" | "github";

export interface BoardSettings {
  provider: BoardProviderKind;
  /** Status names matching this (case-insensitive) get the rejected treatment. */
  rejectedPattern: string;
  /** How many days of Done issues stay on the board. */
  doneWindowDays: number;
  /** Board columns the reviews queue is built from when it is sourced from
   *  the board: every card sitting in one of these puts its open PRs in the
   *  queue. Unused when the queue comes from GitHub. */
  reviewColumns: string[];
  /** What happens to an issue when one of its PRs is merged from deck. */
  onMerge: OnMergeSettings;
}

export interface JiraSettings {
  baseUrl: string;
  email: string;
  apiToken: string;
  boardId: string;
}

export interface LinearSettings {
  apiKey: string;
  /** Team key as in issue identifiers, e.g. ENG for ENG-123. */
  teamKey: string;
}

export interface GithubProjectsSettings {
  /** Organisation or user that owns the project. */
  owner: string;
  /** The number in the project's URL. */
  projectNumber: string;
}

/** - "local": the card shows in the target column on deck's board only, until
 *    the tracker catches up (its own automation) or the issue moves elsewhere.
 *  - "remote": deck moves the issue in the tracker itself. */
export type OnMergeMode = "local" | "remote";

export interface OnMergeSettings {
  enabled: boolean;
  /** Board column the issue lands in. */
  column: string;
  mode: OnMergeMode;
}

/** Where the reviews queue gets its pull requests.
 *  - "github": every open PR GitHub has asked the user to review.
 *  - "board": the open PRs of the cards in the board's review columns,
 *    whether or not GitHub asked the user for a review. */
export type ReviewSource = "github" | "board";

/** Which sessions the agent page may be told about: every live one, those in
 *  the repository being worked in, or those under a listed project. */
export type SharingMode = "all" | "current" | "allowlist";

export interface AgentSharingSettings {
  mode: SharingMode;
  /** Directories whose sessions may be shared in "allowlist" mode. Supports ~;
   *  a session matches when its cwd is the directory or sits inside it. */
  projects: string[];
  /** Whether a shared session may also carry its last messages. */
  transcripts: boolean;
  /** Whether the cached issue board is shared at all. */
  board: boolean;
  /** Whether the pull request inbox is shared at all. */
  pullRequests: boolean;
}

export interface GithubSettings {
  /** Org/user that scopes PR search; empty searches all of GitHub. */
  owner: string;
}

/** Whether the hotkey shares the regular window (Dock, tray), gets a panel of
 *  its own onto the same tabs, or a panel that keeps its tabs to itself. */
export type WindowMode = "shared" | "panel" | "panel-own-tabs";

/** Which window a terminal was opened from. */
export type WindowRole = "main" | "panel";

/** What an agent does with a fix it prepared for one of the user's PRs.
 *  - "review": pauses with the diff for the user to approve the push.
 *  - "push": commits and pushes unattended. */
export type AutoFixPush = "review" | "push";

export interface AutoFixSettings {
  enabled: boolean;
  /** Start an agent when CI fails on one of the user's open PRs. */
  ci: boolean;
  /** Start an agent when one of the user's open PRs gets merge conflicts. */
  conflicts: boolean;
  push: AutoFixPush;
}

/** Where a new terminal starts.
 *  - "current": the active terminal's folder, falling back to `defaultCwd`.
 *  - "default": always `defaultCwd`. */
export type StartCwd = "current" | "default";

export interface NewTerminalCwdSettings {
  tab: StartCwd;
  split: StartCwd;
}

/** The page deck opens on. */
export type DefaultView = "terminal" | "board" | "agent" | "reviews";

/** Models the orchestrator can run on: aliases claude accepts plus the full id where no alias exists. */
export const askModels = [
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "haiku", label: "Haiku" },
] as const;

export interface DeckSettings {
  /** Shortcut overrides by command; missing commands use the defaults. */
  keybinds: Partial<Keybinds>;
  defaultAgent: Agent;
  /** Claude model alias or id used by deck's own orchestrator turns. */
  askModel: string;
  defaultView: DefaultView;
  autoFix: AutoFixSettings;
  /** Where the reviews queue comes from; `board.reviewColumns` names the
   *  columns the board source reads. */
  reviewSource: ReviewSource;
  board: BoardSettings;
  jira: JiraSettings;
  linear: LinearSettings;
  githubProjects: GithubProjectsSettings;
  github: GithubSettings;
  agentSharing: AgentSharingSettings;
  windowMode: WindowMode;
  /** Electron accelerator that summons/hides the window from anywhere. */
  summonHotkey: string;
  /** Master switch for the summon hotkey. */
  summonHotkeyEnabled: boolean;
  /** Whether the hotkey docks the window to the top of the screen (quake style). */
  summonDockToTop: boolean;
  /** Quake-style panel height as a fraction of the screen's work area. */
  summonHeightRatio: number;
  /** Hide a hotkey-summoned quake panel as soon as another app takes focus. */
  summonHideOnBlur: boolean;
  /** Keep Deck out of the Dock and Cmd-Tab; it lives in the tray and the hotkey. */
  hideFromDock: boolean;
  /** Directories deck treats as repo roots (search fallbacks, repo pickers). */
  repoRoots: string[];
  /** Folder new terminals fall back to. Supports ~. */
  defaultCwd: string;
  newTerminalCwd: NewTerminalCwdSettings;
  /** Built-in id, custom:<id>, or <plugin-id>:<theme-id>. */
  theme: string;
  /** One-off hints about shortcuts and features deck notices you could use. */
  showTips: boolean;
  /** Whether first-run setup has been through. Until then deck opens on it. */
  onboarded: boolean;
  terminalAppearance: TerminalAppearanceSettings;
}

export const defaultSettings: DeckSettings = {
  keybinds: {},
  defaultAgent: "claude",
  askModel: "sonnet",
  defaultView: "terminal",
  autoFix: { enabled: false, ci: true, conflicts: true, push: "review" },
  reviewSource: "github",
  board: {
    provider: "jira",
    rejectedPattern: "reject",
    doneWindowDays: 7,
    reviewColumns: [],
    onMerge: { enabled: false, column: "", mode: "local" },
  },
  jira: { baseUrl: "", email: "", apiToken: "", boardId: "" },
  linear: { apiKey: "", teamKey: "" },
  githubProjects: { owner: "", projectNumber: "" },
  github: { owner: "" },
  agentSharing: { mode: "all", projects: [], transcripts: true, board: true, pullRequests: true },
  windowMode: "shared",
  summonHotkey: "Alt+Space",
  summonHotkeyEnabled: true,
  summonDockToTop: true,
  summonHeightRatio: 0.6,
  summonHideOnBlur: true,
  hideFromDock: false,
  repoRoots: [],
  defaultCwd: "~",
  newTerminalCwd: { tab: "current", split: "current" },
  theme: "dark",
  showTips: true,
  onboarded: false,
  terminalAppearance: {
    fontFamily: "",
    fontSize: 13,
    fontWeight: "normal",
    fontWeightBold: "bold",
    lineHeight: 1,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: "block",
  },
};
