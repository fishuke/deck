import { useDisplayMode } from "../chrome/DisplayMode.js";
import { useEffect, useRef, useState } from "react";
import { agentLabels } from "../../../shared/agents.js";
import { onOpenTerminalTab } from "../lib/bus.js";
import { useTips } from "../tips/TipsProvider.js";
import { useAgentSessions } from "../lib/useSessions.js";
import { shortPath, useGitSummary } from "../lib/useGitSummary.js";
import { useSettings } from "../lib/useSettings.js";
import { matchKeybind, resolveKeybinds } from "../../../shared/keybinds.js";
import { useTabs } from "../store.js";
import { Icon } from "../board/icons.js";
import { ChangesPanel } from "./ChangesPanel.js";
import { TerminalPane } from "./TerminalPane.js";
import { FileExplorer } from "./FileExplorer.js";
import { onTerminalAction, terminalAction } from "./actions.js";
import { paneIds, paneRects, paneDividers, pruneLayout, resizePane, splitPane, type PaneLayout, type PaneDivider } from "./layout.js";

function savedLayouts(): PaneLayout[] {
  try { return JSON.parse(localStorage.getItem("deck.pane-layouts") ?? "[]"); } catch { return []; }
}

export function TerminalView({ visible }: { visible: boolean }) {
  const { mode } = useDisplayMode();
  const { tabs, activeId, ready, newTab, setTitle, setTabColor, focusTab, requestCloseTab } = useTabs();
  const sessions = useAgentSessions();
  const [panel, setPanel] = useState<"changes" | "files">();
  const [filesVisited, setFilesVisited] = useState(false);
  const [layouts, setLayouts] = useState<PaneLayout[]>(savedLayouts);
  const [composer, setComposer] = useState(false);
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const splitting = useRef(false);
  const paneArea = useRef<HTMLDivElement>(null);
  const dragging = useRef<PaneDivider>();
  const activeTab = tabs.find((tab) => tab.termId === activeId);
  const session = sessions.find((session) => session.term_id === activeId && session.status !== "ended");
  const cwd = session?.cwd || activeTab?.cwd;
  const git = useGitSummary(cwd);
  const settings = useSettings();
  const { report } = useTips();
  const defaultAgent = settings?.defaultAgent ?? "claude";
  const needsReview = session?.status === "needs_review";
  const currentLayout = layouts.find((layout) => paneIds(layout).includes(activeId ?? ""));
  const dividers = currentLayout && mode === "normal" ? paneDividers(currentLayout) : [];
  const rects = currentLayout && mode === "normal" ? paneRects(currentLayout) : activeId ? [{ termId: activeId, left: 0, top: 0, width: 100, height: 100 }] : [];
  useEffect(() => onOpenTerminalTab((options) => void newTab(options)), [newTab]);
  useEffect(() => { if (ready && tabs.length === 0) void newTab(); }, [ready]);
  useEffect(() => {
    if (!ready) return;
    setLayouts((layouts) => {
      const live = new Set(tabs.map((tab) => tab.termId));
      const kept = layouts.map((layout) => pruneLayout(layout, live)).filter((layout): layout is PaneLayout => Boolean(layout));
      const known = new Set(kept.flatMap(paneIds));
      return [...kept, ...tabs.filter((tab) => !known.has(tab.termId)).map((tab) => ({ termId: tab.termId }))];
    });
  }, [tabs.map((tab) => tab.termId).join(","), ready]);
  useEffect(() => { if (ready) localStorage.setItem("deck.pane-layouts", JSON.stringify(layouts)); }, [layouts, ready]);
  useEffect(() => { if (panel === "files") setFilesVisited(true); }, [panel]);
  useEffect(() => { if (needsReview) setPanel("changes"); }, [needsReview, activeId]);
  const split = async (direction: "row" | "column") => {
    if (!activeId || splitting.current) return;
    splitting.current = true;
    try {
      const meta = await window.deck.term.create({ cwd: settings?.newTerminalCwd.split === "default" ? undefined : cwd });
      setLayouts((layouts) => {
        const withoutNew = layouts.filter((layout) => !("termId" in layout && layout.termId === meta.id));
        const found = withoutNew.some((layout) => paneIds(layout).includes(activeId));
        return found ? withoutNew.map((layout) => splitPane(layout, activeId, meta.id, direction))
          : [...withoutNew, splitPane({ termId: activeId }, activeId, meta.id, direction)];
      });
      focusTab(meta.id);
    } catch (error) { setError(String(error)); }
    finally { splitting.current = false; }
  };
  useEffect(() => onTerminalAction((action) => {
    if (action === "changes") setPanel((panel) => panel === "changes" ? undefined : "changes");
    if (action === "files") setPanel((panel) => panel === "files" ? undefined : "files");
    if (action === "composer") setComposer((open) => !open);
    if (action === "split-right") void split("row");
    if (action === "split-down") void split("column");
  }), [activeId, cwd, settings]);
  // Summoning the window back restores keyboard focus to the active terminal.
  useEffect(() => {
    if (!visible) return;
    const onFocus = () => terminalAction("focus");
    window.addEventListener("focus", onFocus);
    const offFocused = window.deck.window.onFocused(onFocus);
    return () => { window.removeEventListener("focus", onFocus); offFocused(); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const keybinds = resolveKeybinds(settings?.keybinds);
    const onKey = (event: KeyboardEvent) => {
      const command = matchKeybind(keybinds, event);
      if (command === "split.right") { event.preventDefault(); void split("row"); }
      if (command === "split.down") { event.preventDefault(); void split("column"); }
      if (command === "changes" || command === "find" || command === "composer") { event.preventDefault(); terminalAction(command); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, activeId, cwd, settings]);
  const resize = (divider: PaneDivider, ratio: number) => setLayouts((layouts) => layouts.map((layout) => paneIds(layout).includes(activeId ?? "") ? resizePane(layout, divider.path, ratio) : layout));
  const submit = () => {
    if (!activeId || !command.trim()) return;
    window.deck.term.input(activeId, `\x1b[200~${command}\x1b[201~`);
    setTimeout(() => window.deck.term.input(activeId, "\r"), 200);
    setCommand("");
  };
  return <div className={`relative min-h-0 flex-1 ${visible ? "flex" : "hidden"}`}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="workbench-chrome flex h-16 shrink-0 items-center gap-4 border-b border-edge px-4 font-sans">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-mut"><span className="truncate">{shortPath(cwd)}</span>{git && <><Icon name="branch" size={11} /><span>{git.branch}</span><span className="text-dim">· {git.changedFiles} changed</span></>}</div>
          <div className="mt-1 truncate text-[13px] font-semibold text-soft">{activeTab?.customTitle || session?.title || activeTab?.agent || activeTab?.title || "Terminal"}</div>
        </div>
        <div className="flex items-center gap-1">
          <button title="Split right (⌘D)" aria-label="Split right" onClick={() => { report({ action: "split-button" }); void split("row"); }} className="toolbar-button"><Icon name="splitRight" size={15} /></button>
          <button title="Split down (⌘⇧D)" aria-label="Split down" onClick={() => { report({ action: "split-button" }); void split("column"); }} className="toolbar-button"><Icon name="splitDown" size={15} /></button>
          <button title="Find in terminal (⌘F)" aria-label="Find in terminal" onClick={() => terminalAction("find")} className="toolbar-button"><Icon name="search" size={15} /></button>
          <button title="Export terminal output" aria-label="Export terminal output" onClick={() => terminalAction("export")} className="toolbar-button"><Icon name="download" size={15} /></button>
        </div>
      </div>
      {error && <div className="px-4 py-2 text-xs text-red">{error}<button className="ml-2" onClick={() => setError("")}>×</button></div>}
      <div ref={paneArea} className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const rect = rects.find((rect) => rect.termId === tab.termId);
          const shown = visible && Boolean(rect);
          return <div key={tab.termId} className={`absolute overflow-hidden ${rects.length > 1 ? `border ${tab.termId === activeId ? "border-edge3" : "border-edge"}` : ""}`}
            style={rect ? { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%`, display: shown ? "flex" : "none", flexDirection: "column" } : { display: "none" }}
            onMouseDown={() => { if (activeId !== tab.termId) focusTab(tab.termId); }}>
            {rects.length > 1 && <div className="flex h-6 shrink-0 items-center gap-2 bg-panel px-3 font-sans text-[10px] text-mut"><Icon name="terminal" size={10} /><span className="truncate">{tab.customTitle || tab.title}</span><button className="ml-auto" title="Close pane" onClick={() => requestCloseTab(tab.termId)}><Icon name="x" size={10} /></button></div>}
            <div className="min-h-0 flex-1"><TerminalPane termId={tab.termId} cwd={tab.cwd} busy={tab.busy} active={shown} focused={shown && tab.termId === activeId} onTitle={(title) => setTitle(tab.termId, title)} onTabColor={(color) => setTabColor(tab.termId, color)} onCommand={(command) => report({ command })} onFileDrop={() => focusTab(tab.termId)} /></div>
          </div>;
        })}
        {dividers.map((divider) => <div key={divider.path.join("/") || "root"} role="separator" tabIndex={0} aria-label="Resize terminal panes" aria-orientation={divider.direction === "row" ? "vertical" : "horizontal"} aria-valuenow={Math.round(divider.ratio * 100)}
          onDoubleClick={() => resize(divider, 0.5)}
          onKeyDown={(event) => { if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); resize(divider, divider.ratio + (["ArrowRight", "ArrowDown"].includes(event.key) ? 0.05 : -0.05)); } }}
          onPointerDown={(event) => { dragging.current = divider; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => {
            const moving = dragging.current;
            const area = paneArea.current?.getBoundingClientRect();
            if (!moving || !area) return;
            const position = moving.direction === "row" ? (event.clientX - area.left) / area.width * 100 : (event.clientY - area.top) / area.height * 100;
            const start = moving.direction === "row" ? moving.area.left : moving.area.top;
            const size = moving.direction === "row" ? moving.area.width : moving.area.height;
            resize(moving, (position - start) / size);
          }}
          onPointerUp={() => { dragging.current = undefined; }}
          style={divider.direction === "row" ? { left: `calc(${divider.area.left + divider.area.width * divider.ratio}% - 3px)`, top: `${divider.area.top}%`, width: 6, height: `${divider.area.height}%`, cursor: "col-resize" } : { top: `calc(${divider.area.top + divider.area.height * divider.ratio}% - 3px)`, left: `${divider.area.left}%`, height: 6, width: `${divider.area.width}%`, cursor: "row-resize" }}
          className="absolute z-10 select-none outline-none hover:bg-edge3 focus-visible:bg-accent" />)}
        {!tabs.length && <div className="flex h-full items-center justify-center font-sans text-xs text-dim">⌘T to open a terminal</div>}
      </div>
      {composer && <div className="workbench-chrome mx-4 mb-3 rounded-lg border border-edge3 bg-card px-3 py-2">
        <textarea aria-label="Command editor" autoFocus rows={3} value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); submit(); } }} placeholder="Write a command or paste a multiline prompt…" className="w-full resize-y bg-transparent font-mono text-xs leading-5 text-soft outline-none placeholder:text-dim" />
        <div className="flex items-center gap-2 font-sans text-[10px] text-dim"><span>Send to active terminal</span><button className="ml-auto text-mut" onClick={() => setComposer(false)}>Close</button><button disabled={!command.trim()} onClick={submit} className="rounded border border-edge3 px-2 py-1 text-soft disabled:opacity-30">Send ⌘↵</button></div>
      </div>}
      <footer className="workbench-chrome flex h-10 shrink-0 items-center gap-2 border-t border-edge px-4 font-sans text-[11px] text-mut">
        <button title="New terminal (⌘T)" onClick={() => { report({ action: "new-tab-button" }); void newTab(); }} className="toolbar-button"><Icon name="plus" size={13} /></button>
        <button title={`New ${agentLabels[defaultAgent]} tab (⌘⇧N)`} onClick={() => void newTab({ agent: defaultAgent })} className="toolbar-button"><Icon name="sparkle" size={13} /></button>
        {git && <button onClick={() => terminalAction("changes")} className="flex items-center gap-1.5 rounded border border-edge2 px-2 py-0.5"><Icon name="file" size={11} /><span>{git.changedFiles}</span><span className="text-green">+{git.added}</span><span className="text-red">−{git.removed}</span></button>}
        <button onClick={() => terminalAction("files")} className={`flex items-center gap-1.5 rounded px-2 py-1 ${panel === "files" ? "bg-card2 text-soft" : "hover:text-soft"}`}><Icon name="folder" size={12} />File explorer</button>
        <button onClick={() => setComposer(!composer)} className={`flex items-center gap-1.5 rounded px-2 py-1 ${composer ? "bg-card2 text-soft" : "hover:text-soft"}`}><Icon name="pencil" size={12} />Rich input <kbd className="text-dim">⌘J</kbd></button>
        <span className="ml-auto min-w-0 truncate text-dim">{shortPath(cwd)}</span>
        {git && <button onClick={() => terminalAction("changes")} className="flex items-center gap-1.5 rounded border border-edge2 px-2 py-0.5"><Icon name="branch" size={11} />{git.branch}</button>}
        {needsReview && <button onClick={() => setPanel("changes")} className="text-orange">Needs review</button>}
      </footer>
    </div>
    {panel === "changes" && <div className="terminal-side-panel workbench-chrome flex min-h-0"><ChangesPanel cwd={cwd} session={session} onClose={() => setPanel(undefined)} /></div>}
    {filesVisited && <div style={panel === "files" ? undefined : { display: "none" }} className="terminal-side-panel workbench-chrome flex min-h-0"><FileExplorer cwd={cwd} onClose={() => setPanel(undefined)} /></div>}
  </div>;
}
