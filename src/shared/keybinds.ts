import { isMac } from "./platform.js";

/** Rebindable keyboard shortcuts. A chord is stored as modifiers and a key
 *  joined by "+", e.g. "Meta+Shift+T" or "Meta+Alt+Digit1". Letters and digits
 *  come from the physical key so ⌥3 (which types "£" on a Mac) still matches. */

export type KeybindCommand =
  | "search" | "settings" | "sidebar" | "window.new"
  | "view.terminal" | "view.board" | "view.agent" | "view.reviews"
  | "zen" | "presentation"
  | "workspace.next" | "workspace.prev"
  | "tab.new" | "tab.newAgent" | "tab.close" | "tab.reopen" | "tab.next" | "tab.prev"
  | "split.right" | "split.down" | "find" | "composer" | "changes" | "canvas"
  | "font.increase" | "font.decrease" | "font.reset";

export type Keybinds = Record<KeybindCommand, string>;

export interface KeybindInfo {
  id: KeybindCommand;
  label: string;
  group: "Workbench" | "Terminal";
  default: string;
}

// Elsewhere Ctrl is the shell's own modifier (Ctrl+T, Ctrl+W, Ctrl+D all
// mean something at a prompt), so a ⌘ chord becomes Ctrl+Shift, the way
// Windows Terminal does it, and a ⌘⇧ chord whose Ctrl+Shift twin is taken
// becomes Alt+Shift. Ctrl+Alt stays free: it is AltGr, which types € and ę.
const platformDefault = (mac: string, other: string): string => isMac ? mac : other;

export const keybindInfos: KeybindInfo[] = [
  { id: "search", label: "Search sessions, history, commands, settings, themes and repositories", group: "Workbench", default: platformDefault("Meta+K", "Ctrl+Shift+K") },
  { id: "settings", label: "Open settings", group: "Workbench", default: platformDefault("Meta+,", "Ctrl+,") },
  { id: "sidebar", label: "Toggle sidebar", group: "Workbench", default: platformDefault("Meta+B", "Ctrl+Shift+B") },
  { id: "window.new", label: "New window", group: "Workbench", default: platformDefault("Meta+N", "Ctrl+Shift+N") },
  { id: "view.terminal", label: "Terminal page", group: "Workbench", default: platformDefault("Meta+Alt+Digit1", "Alt+Digit1") },
  { id: "view.board", label: "Board page", group: "Workbench", default: platformDefault("Meta+Alt+Digit2", "Alt+Digit2") },
  { id: "view.agent", label: "Agent page", group: "Workbench", default: platformDefault("Meta+Alt+Digit3", "Alt+Digit3") },
  { id: "view.reviews", label: "Reviews page", group: "Workbench", default: platformDefault("Meta+Alt+Digit4", "Alt+Digit4") },
  { id: "zen", label: "Toggle Zen view", group: "Workbench", default: platformDefault("Meta+Shift+Enter", "Ctrl+Shift+Enter") },
  { id: "presentation", label: "Toggle Presentation view", group: "Workbench", default: platformDefault("Meta+Shift+P", "Ctrl+Shift+P") },
  { id: "workspace.next", label: "Next workspace", group: "Workbench", default: platformDefault("Meta+Alt+ArrowRight", "Ctrl+Shift+PageDown") },
  { id: "workspace.prev", label: "Previous workspace", group: "Workbench", default: platformDefault("Meta+Alt+ArrowLeft", "Ctrl+Shift+PageUp") },
  { id: "tab.new", label: "New terminal tab", group: "Terminal", default: platformDefault("Meta+T", "Ctrl+Shift+T") },
  { id: "tab.newAgent", label: "New tab running the default agent", group: "Terminal", default: platformDefault("Meta+Shift+N", "Alt+Shift+N") },
  { id: "tab.close", label: "Close the active tab", group: "Terminal", default: platformDefault("Meta+W", "Ctrl+Shift+W") },
  { id: "tab.reopen", label: "Reopen the last closed tab", group: "Terminal", default: platformDefault("Meta+Shift+T", "Alt+Shift+T") },
  { id: "tab.next", label: "Next tab", group: "Terminal", default: "Ctrl+Tab" },
  { id: "tab.prev", label: "Previous tab", group: "Terminal", default: "Ctrl+Shift+Tab" },
  { id: "split.right", label: "Split right", group: "Terminal", default: platformDefault("Meta+D", "Ctrl+Shift+D") },
  { id: "split.down", label: "Split down", group: "Terminal", default: platformDefault("Meta+Shift+D", "Alt+Shift+D") },
  { id: "find", label: "Find in terminal output", group: "Terminal", default: platformDefault("Meta+F", "Ctrl+Shift+F") },
  { id: "composer", label: "Toggle multiline input", group: "Terminal", default: platformDefault("Meta+J", "Ctrl+Shift+J") },
  { id: "changes", label: "Toggle the changes panel", group: "Terminal", default: platformDefault("Meta+E", "Ctrl+Shift+E") },
  { id: "canvas", label: "Toggle the canvas panel", group: "Terminal", default: platformDefault("Meta+Shift+E", "Alt+Shift+E") },
  { id: "font.increase", label: "Larger terminal text", group: "Terminal", default: platformDefault("Meta+=", "Ctrl+=") },
  { id: "font.decrease", label: "Smaller terminal text", group: "Terminal", default: platformDefault("Meta+-", "Ctrl+-") },
  { id: "font.reset", label: "Reset terminal text size", group: "Terminal", default: platformDefault("Meta+Digit0", "Ctrl+Digit0") },
];

export const defaultKeybinds = Object.fromEntries(keybindInfos.map((info) => [info.id, info.default])) as Keybinds;

/** Fills gaps in a stored override map with the defaults. */
export function resolveKeybinds(overrides: Partial<Keybinds> | undefined): Keybinds {
  return { ...defaultKeybinds, ...overrides };
}

/** The chord a keyboard event represents, or undefined for a bare modifier press. */
/** The parts of a KeyboardEvent a chord is built from; kept local so this file also compiles for the main process. */
export interface KeyPress { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

export function chordOf(event: KeyPress): string | undefined {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return undefined;
  const modifiers = [event.metaKey && "Meta", event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  const physical = /^(Digit\d|Key[A-Z])$/.exec(event.code)?.[0];
  const key = physical ? (physical.startsWith("Key") ? physical.slice(3) : physical) : event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

export function matchKeybind(keybinds: Keybinds, event: KeyPress): KeybindCommand | undefined {
  const chord = chordOf(event);
  return chord ? (Object.keys(keybinds) as KeybindCommand[]).find((id) => keybinds[id] === chord) : undefined;
}

const symbols: Record<string, string> = { Meta: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "⏎", Escape: "esc", Backspace: "⌫", Tab: "⇥", Space: "space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
/** Windows and Linux spell modifiers out and join them with "+". */
const words: Record<string, string> = { Meta: "Win", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Enter: "Enter", Escape: "Esc", Backspace: "Backspace", Tab: "Tab", Space: "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

const acceleratorParts: Record<string, string> = { Meta: isMac ? "CommandOrControl" : "Super", Ctrl: "Control", Enter: "Return", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };

/** "Meta+Alt+Digit1" as the electron accelerator "CommandOrControl+Alt+1". */
export function acceleratorOf(chord: string): string | undefined {
  const parts = chord.split("+").map((part) => acceleratorParts[part] ?? part.replace(/^Digit/, ""));
  return parts.length > 1 ? parts.join("+") : undefined;
}

/** "Meta+Shift+Enter" as "⌘⇧⏎" for display, "Ctrl+Shift+Enter" elsewhere. */
export function formatChord(chord: string, mac = isMac): string {
  return chord.split("+").map((part) => (mac ? symbols : words)[part] ?? part.replace(/^Digit/, "")).join(mac ? "" : "+");
}

const acceleratorSymbols: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Cmd: "⌘", Super: "⌘", Control: "⌃", Option: "⌥", Return: "⏎" };
const acceleratorWords: Record<string, string> = { CommandOrControl: "Ctrl", CmdOrCtrl: "Ctrl", Control: "Ctrl", Super: "Win", Option: "Alt", Return: "Enter" };

/** "CommandOrControl+Shift+Space" as "⌘⇧space" for display. The summon hotkey
 *  is stored as an accelerator rather than a chord, so it formats from here. */
export function formatAccelerator(accelerator: string, mac = isMac): string {
  return mac
    ? accelerator.split("+").map((part) => acceleratorSymbols[part] ?? symbols[part] ?? part).join("")
    : accelerator.split("+").map((part) => acceleratorWords[part] ?? words[part] ?? part).join("+");
}

/** The modifier deck's own unbindable shortcuts use: ⌘ on a Mac, Ctrl elsewhere. */
export function primaryModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** "⌘" on a Mac, "Ctrl+" elsewhere, to put in front of a key in a hint. */
export const primaryHint = isMac ? "⌘" : "Ctrl+";
