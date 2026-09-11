import { ExtensionProvider } from "./extensions/ExtensionProvider.js";
import { DisplayModeProvider, FocusModeBar, useDisplayMode } from "./chrome/DisplayMode.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentDock } from "./agents/AgentDock.js";
import { AgentPage } from "./agents/AgentPage.js";
import { ChatProvider } from "./agents/ChatStore.js";
import { BoardView } from "./board/BoardView.js";
import { ReviewsView } from "./board/ReviewsView.js";
import { SettingsView, type SettingsSection } from "./chrome/SettingsView.js";
import { SettingsProvider, useSettings } from "./lib/useSettings.js";
import { isRecordingKeys } from "./lib/useKeybinds.js";
import { matchKeybind, resolveKeybinds, type KeybindCommand } from "../../shared/keybinds.js";
import { defaultSettings } from "../../shared/settings.js";
import { fontSize as safeFontSize } from "../../shared/terminal.js";
import { useTerminalAppearance } from "./lib/useTerminalAppearance.js";
import { Onboarding } from "./chrome/Onboarding.js";
import { Sidebar } from "./chrome/Sidebar.js";
import { Titlebar } from "./chrome/Titlebar.js";
import { onOpenTerminalTab, requestNavBack } from "./lib/bus.js";
import { SearchOverlay } from "./search/SearchOverlay.js";
import { WorktreeClosePrompt } from "./chrome/WorktreeClosePrompt.js";
import { SearchView } from "./search/SearchView.js";
import { TabProvider, useTabs } from "./store.js";
import { TerminalView } from "./terminal/TerminalView.js";
import { TipsProvider } from "./tips/TipsProvider.js";

export type View = "terminal" | "board" | "agent" | "reviews" | "search" | "settings";

export default function App() {
  return (
    <SettingsProvider>
      <DisplayModeProvider>
        <TabProvider>
          <ExtensionProvider><ChatProvider><TipsProvider><Shell /></TipsProvider></ChatProvider></ExtensionProvider>
        </TabProvider>
      </DisplayModeProvider>
    </SettingsProvider>
  );
}

function Shell() {
  const { mode, setMode, presentationSize } = useDisplayMode();
  const { fontSize: terminalFontSize } = useTerminalAppearance();
  const [view, setViewRaw] = useState<View>("terminal");
  // The configured start page applies once, unless the user already moved on.
  useEffect(() => {
    void window.deck.getSettings().then(({ defaultView }) => {
      if (history.current.stack.length === 1) { setViewRaw(defaultView); history.current.stack = [defaultView]; }
    });
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("deck.sidebar") !== "hidden");
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => { localStorage.setItem("deck.sidebar", open ? "hidden" : "visible"); return !open; }), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  // Pages stay mounted across switches, so replay the enter animation by hand.
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => { pageRef.current?.getAnimations().forEach((animation) => { animation.cancel(); animation.play(); }); }, [view]);
  const [preview, setPreview] = useState<{ sessionId: string; query: string }>();
  const { tabs, focusTab, newTab, requestCloseTab, reopenTab, activeId } = useTabs();
  const settings = useSettings();
  const keybinds = resolveKeybinds(settings?.keybinds);
  // First run sets the summon hotkey up before the workbench is usable.
  const onboarding = settings?.onboarded === false;

  // View history for the mouse back/forward buttons.
  const history = useRef({ stack: ["terminal"] as View[], index: 0 });
  const setView = useCallback((v: View) => {
    setViewRaw((current) => {
      if (v !== current) {
        const h = history.current;
        h.stack = [...h.stack.slice(0, h.index + 1), v];
        h.index = h.stack.length - 1;
      }
      return v;
    });
  }, []);
  // Zen and Presentation go fullscreen like WebStorm's; leaving restores
  // whatever the window was before.
  const wasFullScreen = useRef(false);
  useEffect(() => {
    if (mode === "normal") { if (!wasFullScreen.current) void window.deck.window.setFullScreen(false); return; }
    void window.deck.window.isFullScreen().then((on) => { wasFullScreen.current = on; if (!on) void window.deck.window.setFullScreen(true); });
  }, [mode]);
  useEffect(() => {
    const onModeKey = (event: KeyboardEvent) => {
      if (searchOpen || onboarding || isRecordingKeys(event)) return;
      const command = matchKeybind(keybinds, event);
      // Other pages use Escape themselves (closing composers and menus).
      if (event.key === "Escape" && mode !== "normal" && view === "terminal") {
        event.preventDefault(); event.stopImmediatePropagation(); setMode("normal");
      } else if (command === "zen") {
        event.preventDefault(); event.stopImmediatePropagation(); setMode(mode === "zen" ? "normal" : "zen");
      } else if (command === "presentation") {
        event.preventDefault(); event.stopImmediatePropagation(); setMode(mode === "presentation" ? "normal" : "presentation");
      }
    };
    window.addEventListener("keydown", onModeKey, true);
    return () => window.removeEventListener("keydown", onModeKey, true);
  }, [mode, setMode, searchOpen, onboarding, view, keybinds]);

  const goBack = useCallback(() => {
    if (requestNavBack()) return; // an overlay consumed it
    const h = history.current;
    if (h.index > 0) setViewRaw(h.stack[--h.index]);
  }, []);
  const goForward = useCallback(() => {
    const h = history.current;
    if (h.index < h.stack.length - 1) setViewRaw(h.stack[++h.index]);
  }, []);

  useEffect(() => {
    // macOS reports the thumb buttons as mouse buttons 3 and 4.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("mouseup", onMouse);
    return () => window.removeEventListener("mouseup", onMouse);
  }, [goBack, goForward]);

  // Opening a tab from anywhere lands back in the terminal.
  useEffect(() => onOpenTerminalTab(() => setView("terminal")), [setView]);

  const openPreview = useCallback((sessionId: string, query: string) => {
    setPreview({ sessionId, query });
    setView("search");
  }, []);

  // Shared by the keyboard shortcuts and the application menu, which sends the
  // same command ids. Returns whether the command was handled.
  const runCommand = useCallback((command: KeybindCommand): boolean => {
    if (command === "search") setSearchOpen((open) => !open);
    else if (command === "sidebar") toggleSidebar();
    else if (command === "settings") setView("settings");
    else if (command === "view.terminal") setView("terminal");
    else if (command === "view.board") setView("board");
    else if (command === "view.agent") setView("agent");
    else if (command === "view.reviews") setView("reviews");
    else if (command === "zen") setMode(mode === "zen" ? "normal" : "zen");
    else if (command === "presentation") setMode(mode === "presentation" ? "normal" : "presentation");
    else if (command === "tab.new" || command === "tab.newAgent") {
      setView("terminal");
      void newTab(command === "tab.newAgent" ? { agent: settings?.defaultAgent } : undefined);
    } else if (command === "tab.close" && view === "terminal" && activeId) {
      requestCloseTab(activeId);
    } else if (command === "tab.reopen") {
      setView("terminal");
      void reopenTab();
    } else if ((command === "tab.next" || command === "tab.prev") && tabs.length) {
      const index = tabs.findIndex((tab) => tab.termId === activeId);
      const tab = tabs[(index + (command === "tab.next" ? 1 : -1) + tabs.length) % tabs.length];
      focusTab(tab.termId);
      setView("terminal");
    } else if (command === "window.new") {
      void window.deck.window.open();
    } else if (command === "font.increase" || command === "font.decrease" || command === "font.reset") {
      const appearance = settings?.terminalAppearance ?? defaultSettings.terminalAppearance;
      const size = safeFontSize(appearance.fontSize);
      const next = command === "font.reset"
        ? defaultSettings.terminalAppearance.fontSize
        : safeFontSize(size + (command === "font.increase" ? 1 : -1));
      // Already at a limit: still handled, so the chord never reaches the shell.
      if (next !== appearance.fontSize) void window.deck.updateSettings({ terminalAppearance: { ...appearance, fontSize: next } });
    } else return false;
    return true;
  }, [view, activeId, newTab, requestCloseTab, reopenTab, tabs, focusTab, settings, toggleSidebar, setView, mode, setMode]);

  useEffect(() => window.deck.onMenuCommand(runCommand), [runCommand]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (onboarding || isRecordingKeys(e)) return;
      const command = matchKeybind(keybinds, e);
      if (command === "search") {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      if (searchOpen) return; // the overlay handles its own keys
      if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const tab = tabs[Number(e.key) - 1];
        if (tab) { focusTab(tab.termId); setView("terminal"); }
      } else if (!command || !runCommand(command)) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, onboarding, tabs, focusTab, setView, keybinds, runCommand]);

  return (
    <div className={`flex h-full flex-col ${mode !== "normal" ? "focus-mode" : ""}`} data-display-mode={mode}>
      <FocusModeBar view={view} />
      <div className="workbench-chrome"><Titlebar onSearch={() => setSearchOpen(true)} sidebarOpen={sidebarOpen} onView={setView} onSidebar={toggleSidebar} /></div>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <div className="workbench-chrome flex min-h-0"><Sidebar view={view} onView={setView} /></div>}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TerminalView visible={view === "terminal"} />
          {/* The terminal scales its own font; every other page zooms by the same ratio. */}
          <div ref={pageRef} className={`${view === "terminal" ? "hidden" : "flex"} view-enter min-h-0 min-w-0 flex-1 flex-col`} style={{ zoom: mode === "presentation" ? presentationSize / terminalFontSize : 1 }}>
          {view === "search" && (
            <div className="min-h-0 flex-1">
              <SearchView
                initialQuery={preview?.query}
                initialSessionId={preview?.sessionId}
              />
            </div>
          )}
          <AgentPage visible={view === "agent"} />
          <ReviewsView visible={view === "reviews"} />
          {view === "board" && <BoardView />}
          {view === "settings" && <SettingsView section={settingsSection} onSection={setSettingsSection} />}
          </div>
        </main>
      </div>
      {view !== "agent" && <div className="workbench-chrome"><AgentDock onView={setView} /></div>}
      <WorktreeClosePrompt />
      {onboarding && <Onboarding />}
      {searchOpen && (
        <SearchOverlay onClose={() => setSearchOpen(false)} onPreview={openPreview} onView={setView} onSidebar={toggleSidebar} onSettings={(section) => { setSettingsSection(section); setView("settings"); }} />
      )}
    </div>
  );
}
