import { useDisplayMode } from "./DisplayMode.js";
import { Icon } from "../board/icons.js";
import { useTabs } from "../store.js";
import { useGitSummary } from "../lib/useGitSummary.js";
import { useSettings } from "../lib/useSettings.js";
import { terminalAction } from "../terminal/actions.js";
import { useTips } from "../tips/TipsProvider.js";
import type { View } from "../App.js";

export function Titlebar({ onSearch, onSidebar, onView, sidebarOpen }: { onSearch: () => void; onSidebar: () => void; onView: (view: View) => void; sidebarOpen: boolean }) {
  const { setMode } = useDisplayMode();
  const { report } = useTips();
  const { tabs, activeId } = useTabs();
  const git = useGitSummary(tabs.find((tab) => tab.termId === activeId)?.cwd);
  const settings = useSettings();
  const workspaces = settings?.workspaces ?? [];
  return <header className="drag-region flex h-11 shrink-0 items-center gap-1 border-b border-edge bg-bg pl-[100px] pr-3 font-sans">
    <button onClick={() => { report({ action: "sidebar-button" }); onSidebar(); }} aria-label="Toggle sidebar" aria-pressed={sidebarOpen} title="Toggle sidebar (⌘B)" className={`toolbar-button ${sidebarOpen ? "bg-card2 text-soft" : ""}`}><Icon name="sidebar" size={17} /></button>
    {workspaces.length > 1 && <select aria-label="Workspace" title="Workspace" value={settings?.activeWorkspace} onChange={(event) => void window.deck.updateSettings({ activeWorkspace: event.target.value })}
      className="h-7 max-w-[160px] truncate rounded-md bg-card px-2 text-[12px] text-soft outline-none hover:bg-card2">
      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>}
    <div className="flex min-w-0 flex-1 justify-center px-8">
      <button onClick={onSearch} className="flex h-7 w-full max-w-[390px] items-center gap-2 rounded-md bg-card px-3 text-[12px] text-mut hover:bg-card2 hover:text-soft">
        <Icon name="search" size={14} /><span className="flex-1 truncate text-left">Search sessions, history, commands…</span><kbd className="text-[10px] text-dim">⌘K</kbd>
      </button>
    </div>
    {git && <button title="Working-tree changes" onClick={() => { onView("terminal"); terminalAction("changes"); }} className="flex items-center gap-1.5 px-2 text-[11px]"><span className="text-mut">±</span><span className="text-green">+{git.added}</span><span className="text-red">−{git.removed}</span></button>}
    <button onClick={() => setMode("zen")} title="Zen view (⌘⇧Enter)" aria-label="Zen view" className="toolbar-button"><Icon name="zen" size={16} /></button>
    <button onClick={() => setMode("presentation")} title="Presentation view (⌘⇧P)" aria-label="Presentation view" className="toolbar-button"><Icon name="presentation" size={16} /></button>
    <button onClick={() => { report({ action: "settings-button" }); onView("settings"); }} title="Settings" aria-label="Settings" className="toolbar-button"><Icon name="cog" size={17} /></button>
    <span className="ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#c9855d] text-[11px] font-semibold text-bg" title="Deck">D</span>
  </header>;
}
