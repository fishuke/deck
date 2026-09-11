import type { View } from "../App.js";
import { presentationSizes, useDisplayMode, viewTitles } from "../chrome/DisplayMode.js";
import { settingsSections, type SettingsSection } from "../chrome/SettingsView.js";
import { useExtensions } from "../extensions/ExtensionProvider.js";
import { useSettings } from "../lib/useSettings.js";
import { useTabs } from "../store.js";
import { terminalAction, type TerminalAction } from "../terminal/actions.js";
import { agentLabels, type Agent } from "../../../shared/agents.js";
import { formatChord, resolveKeybinds, type KeybindCommand } from "../../../shared/keybinds.js";
import { askModels, defaultSettings, type DeckSettings, type DefaultView } from "../../../shared/settings.js";
import { fontSize as safeFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE, type CursorStyle } from "../../../shared/terminal.js";

// Everything ⌘K can do besides searching: switch pages and display modes,
// drive the terminal, and change settings in place. The overlay only filters
// and renders these.

export interface PaletteItem {
  icon: string;
  iconColor: string;
  title: string;
  meta: string;
  /** Extra words the filter matches, for the other ways people phrase a request ("disable", "bigger"). */
  keywords?: string;
  /** Listed only once the user types, so the empty palette stays short. */
  whenTyping?: boolean;
  open: (inNewPane: boolean) => void;
}

export interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

export interface PaletteActionProps {
  onView: (view: View) => void;
  onSettings: (section: SettingsSection) => void;
  onSidebar: () => void;
}

/** Chromium zoom levels: 0 is 100% and each level scales by 1.2. Electron's own zoom menu steps by half a level. */
const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 3;
const pages: DefaultView[] = ["terminal", "board", "agent", "reviews"];
const agents = Object.keys(agentLabels) as Agent[];
const cursorStyles: { id: CursorStyle; label: string }[] = [{ id: "block", label: "Block" }, { id: "underline", label: "Underline" }, { id: "bar", label: "Bar" }];
const sectionKeywords: Record<SettingsSection, string> = {
  appearance: "theme font terminal cursor",
  plugins: "extensions",
  keybinds: "shortcuts keyboard",
  general: "board jira linear github hotkey agent model start page dock",
};

function item(icon: string, title: string, meta: string, open: () => void, extra: Partial<PaletteItem> = {}): PaletteItem {
  return { icon, iconColor: "text-mut", title, meta, open, ...extra };
}

export function usePaletteActions({ onView, onSettings, onSidebar }: PaletteActionProps): PaletteGroup[] {
  const { commands, runCommand, themes, selectedThemeId, selectTheme } = useExtensions();
  const { mode, setMode, presentationSize, setPresentationSize } = useDisplayMode();
  const { newTab, requestCloseTab, activeId } = useTabs();
  const settings = useSettings();
  const keybinds = resolveKeybinds(settings?.keybinds);
  const chord = (id: KeybindCommand) => formatChord(keybinds[id]);
  const inTerminal = (action: TerminalAction) => () => { onView("terminal"); terminalAction(action); };
  const defaultAgent = settings?.defaultAgent ?? defaultSettings.defaultAgent;
  const zoom = window.deck.window.zoomLevel();
  const zoomTo = (level: number) => () => window.deck.window.setZoomLevel(level);
  const zoomMeta = `Page zoom · ${Math.round(1.2 ** zoom * 100)}%`;

  const actions: PaletteItem[] = [
    item("⛶", mode === "zen" ? "Exit zen view" : "Zen view", chord("zen"), () => setMode(mode === "zen" ? "normal" : "zen")),
    item("▣", mode === "presentation" ? "Exit presentation view" : "Presentation view", chord("presentation"), () => setMode(mode === "presentation" ? "normal" : "presentation")),
  ];
  if (mode === "presentation" && presentationSize < presentationSizes.max) actions.push(item("A", "Larger presentation text", `${presentationSize}px → ${presentationSize + presentationSizes.step}px`, () => setPresentationSize(presentationSize + presentationSizes.step), { keywords: "font size bigger" }));
  if (mode === "presentation" && presentationSize > presentationSizes.min) actions.push(item("A", "Smaller presentation text", `${presentationSize}px → ${presentationSize - presentationSizes.step}px`, () => setPresentationSize(presentationSize - presentationSizes.step), { keywords: "font size" }));
  actions.push(
    item("❯", "New terminal", chord("tab.new"), () => { onView("terminal"); void newTab(); }),
    ...agents.map((agent) => item("✳", `New ${agentLabels[agent]} session`, agent === defaultAgent ? chord("tab.newAgent") : agentLabels[agent], () => { onView("terminal"); void newTab({ agent }); })),
  );
  if (activeId) actions.push(item("×", "Close tab", chord("tab.close"), () => requestCloseTab(activeId)));
  actions.push(
    item("◫", "Split pane right", chord("split.right"), inTerminal("split-right")),
    item("◫", "Split pane down", chord("split.down"), inTerminal("split-down")),
    item("⌕", "Find in terminal", chord("find"), inTerminal("find")),
    item("⌫", "Clear terminal", "Scrollback", inTerminal("clear")),
    item("↓", "Export terminal output", "Save as text", inTerminal("export")),
    item("✎", "Multiline input", chord("composer"), inTerminal("composer"), { keywords: "composer rich" }),
    item("⌂", "File explorer", "Project files", inTerminal("files")),
    item("±", "Working-tree changes", chord("changes"), inTerminal("changes"), { keywords: "git diff" }),
    item("▤", "Toggle sidebar", chord("sidebar"), onSidebar),
    item("⌕", "Search chat history", "Claude + Codex", () => onView("search")),
    ...pages.map((page) => item("◫", `${viewTitles[page]} page`, chord(`view.${page}`), () => onView(page), { keywords: "go to open panel" })),
    ...settingsSections.map((section) => item("⚙", `${section.label} settings`, section.id === "appearance" ? chord("settings") : "Settings", () => onSettings(section.id), { keywords: sectionKeywords[section.id] })),
  );
  if (zoom < ZOOM_LIMIT) actions.push(item("＋", "Zoom in", zoomMeta, zoomTo(zoom + ZOOM_STEP), { keywords: "bigger larger" }));
  if (zoom > -ZOOM_LIMIT) actions.push(item("－", "Zoom out", zoomMeta, zoomTo(zoom - ZOOM_STEP), { keywords: "smaller" }));
  if (zoom !== 0) actions.push(item("⟲", "Reset zoom", zoomMeta, zoomTo(0)));

  const settingsItems: PaletteItem[] = [];
  if (settings) {
    const update = (patch: Partial<DeckSettings>) => void window.deck.updateSettings(patch);
    const appearance = settings.terminalAppearance;
    const size = safeFontSize(appearance.fontSize);
    const setFont = (fontSize: number) => () => update({ terminalAppearance: { ...appearance, fontSize } });
    if (size < MAX_FONT_SIZE) actions.push(item("A", "Increase terminal font size", `${chord("font.increase")} · ${size}px → ${size + 1}px`, setFont(size + 1), { keywords: "bigger larger text zoom in" }));
    if (size > MIN_FONT_SIZE) actions.push(item("A", "Decrease terminal font size", `${chord("font.decrease")} · ${size}px → ${size - 1}px`, setFont(size - 1), { keywords: "smaller text zoom out" }));
    if (size !== defaultSettings.terminalAppearance.fontSize) actions.push(item("A", "Reset terminal font size", `${chord("font.reset")} · ${size}px → ${defaultSettings.terminalAppearance.fontSize}px`, setFont(defaultSettings.terminalAppearance.fontSize), { keywords: "actual size zoom" }));

    const toggle = (on: boolean, whenOn: string, whenOff: string, meta: string, patch: Partial<DeckSettings>) =>
      item("⚙", on ? whenOn : whenOff, meta, () => update(patch), { keywords: "setting toggle enable disable turn on off" });
    // One entry per value the setting could take next; the current value shows in the meta.
    const choices = <T extends string>(label: string, options: readonly { id: T; label: string }[], current: T, apply: (id: T) => void) => {
      const now = options.find((option) => option.id === current)?.label ?? current;
      return options.filter((option) => option.id !== current).map((option) =>
        item("⚙", `${label}: ${option.label}`, `now ${now}`, () => apply(option.id), { whenTyping: true, keywords: "setting set change" }));
    };
    settingsItems.push(
      toggle(settings.showTips, "Turn tips off", "Turn tips on", "Hints about shortcuts", { showTips: !settings.showTips }),
      toggle(settings.summonHotkeyEnabled, "Disable the summon hotkey", "Enable the summon hotkey", settings.summonHotkey, { summonHotkeyEnabled: !settings.summonHotkeyEnabled }),
      toggle(settings.hideFromDock, "Show Deck in the Dock", "Hide Deck from the Dock", "Dock and Cmd-Tab", { hideFromDock: !settings.hideFromDock }),
      toggle(settings.autoFix.enabled, "Turn auto-fix off", "Turn auto-fix on", "Agents fix my broken pull requests", { autoFix: { ...settings.autoFix, enabled: !settings.autoFix.enabled } }),
      toggle(appearance.cursorBlink, "Stop the cursor blinking", "Make the cursor blink", "Terminal", { terminalAppearance: { ...appearance, cursorBlink: !appearance.cursorBlink } }),
      ...choices("Default agent", agents.map((id) => ({ id, label: agentLabels[id] })), settings.defaultAgent, (defaultAgent) => update({ defaultAgent })),
      ...choices<string>("Agent model", askModels, settings.askModel, (askModel) => update({ askModel })),
      ...choices("Start page", pages.map((id) => ({ id, label: viewTitles[id] })), settings.defaultView, (defaultView) => update({ defaultView })),
      ...choices("Cursor style", cursorStyles, appearance.cursorStyle, (cursorStyle) => update({ terminalAppearance: { ...appearance, cursorStyle } })),
    );
  }

  return [
    { label: "ACTIONS", items: actions },
    { label: "SETTINGS", items: settingsItems },
    { label: "PLUGINS", items: commands.map((command) => ({ icon: "◈", iconColor: "text-accent", title: command.title, meta: command.pluginName, keywords: command.description, open: () => void runCommand(command) })) },
    { label: "THEMES", items: themes.map((theme) => item("◐", theme.name, theme.id === selectedThemeId ? "Current theme" : "Apply theme", () => void selectTheme(theme.id), { whenTyping: true, keywords: "theme" })) },
  ];
}
