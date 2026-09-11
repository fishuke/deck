/** Rebindable keyboard shortcuts. A chord is stored as modifiers and a key
 *  joined by "+", e.g. "Meta+Shift+T" or "Meta+Alt+Digit1". Letters and digits
 *  come from the physical key so ⌥3 (which types "£" on a Mac) still matches. */

export type KeybindCommand =
  | "search" | "settings" | "sidebar" | "window.new"
  | "view.terminal" | "view.board" | "view.agent" | "view.reviews"
  | "zen" | "presentation"
  | "tab.new" | "tab.newAgent" | "tab.close" | "tab.reopen" | "tab.next" | "tab.prev"
  | "split.right" | "split.down" | "find" | "composer" | "changes"
  | "font.increase" | "font.decrease" | "font.reset";

export type Keybinds = Record<KeybindCommand, string>;

export interface KeybindInfo {
  id: KeybindCommand;
  label: string;
  group: "Workbench" | "Terminal";
  default: string;
}

export const keybindInfos: KeybindInfo[] = [
  { id: "search", label: "Search sessions, history, commands, settings, themes and repositories", group: "Workbench", default: "Meta+K" },
  { id: "settings", label: "Open settings", group: "Workbench", default: "Meta+," },
  { id: "sidebar", label: "Toggle sidebar", group: "Workbench", default: "Meta+B" },
  { id: "window.new", label: "New window", group: "Workbench", default: "Meta+N" },
  { id: "view.terminal", label: "Terminal page", group: "Workbench", default: "Meta+Alt+Digit1" },
  { id: "view.board", label: "Board page", group: "Workbench", default: "Meta+Alt+Digit2" },
  { id: "view.agent", label: "Agent page", group: "Workbench", default: "Meta+Alt+Digit3" },
  { id: "view.reviews", label: "Reviews page", group: "Workbench", default: "Meta+Alt+Digit4" },
  { id: "zen", label: "Toggle Zen view", group: "Workbench", default: "Meta+Shift+Enter" },
  { id: "presentation", label: "Toggle Presentation view", group: "Workbench", default: "Meta+Shift+P" },
  { id: "tab.new", label: "New terminal tab", group: "Terminal", default: "Meta+T" },
  { id: "tab.newAgent", label: "New tab running the default agent", group: "Terminal", default: "Meta+Shift+N" },
  { id: "tab.close", label: "Close the active tab", group: "Terminal", default: "Meta+W" },
  { id: "tab.reopen", label: "Reopen the last closed tab", group: "Terminal", default: "Meta+Shift+T" },
  { id: "tab.next", label: "Next tab", group: "Terminal", default: "Ctrl+Tab" },
  { id: "tab.prev", label: "Previous tab", group: "Terminal", default: "Ctrl+Shift+Tab" },
  { id: "split.right", label: "Split right", group: "Terminal", default: "Meta+D" },
  { id: "split.down", label: "Split down", group: "Terminal", default: "Meta+Shift+D" },
  { id: "find", label: "Find in terminal output", group: "Terminal", default: "Meta+F" },
  { id: "composer", label: "Toggle multiline input", group: "Terminal", default: "Meta+J" },
  { id: "changes", label: "Toggle the changes panel", group: "Terminal", default: "Meta+E" },
  { id: "font.increase", label: "Larger terminal text", group: "Terminal", default: "Meta+=" },
  { id: "font.decrease", label: "Smaller terminal text", group: "Terminal", default: "Meta+-" },
  { id: "font.reset", label: "Reset terminal text size", group: "Terminal", default: "Meta+Digit0" },
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

const acceleratorParts: Record<string, string> = { Meta: "CommandOrControl", Ctrl: "Control", Enter: "Return", Escape: "Esc" };

/** "Meta+Alt+Digit1" as the electron accelerator "CommandOrControl+Alt+1". */
export function acceleratorOf(chord: string): string | undefined {
  const parts = chord.split("+").map((part) => acceleratorParts[part] ?? part.replace(/^Digit/, ""));
  return parts.length > 1 ? parts.join("+") : undefined;
}

/** "Meta+Shift+Enter" as "⌘⇧⏎" for display. */
export function formatChord(chord: string): string {
  return chord.split("+").map((part) => symbols[part] ?? part.replace(/^Digit/, "")).join("");
}

const acceleratorSymbols: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Cmd: "⌘", Super: "⌘", Control: "⌃", Option: "⌥", Return: "⏎" };

/** "CommandOrControl+Shift+Space" as "⌘⇧space" for display. The summon hotkey
 *  is stored as an accelerator rather than a chord, so it formats from here. */
export function formatAccelerator(accelerator: string): string {
  return accelerator.split("+").map((part) => acceleratorSymbols[part] ?? symbols[part] ?? part).join("");
}
