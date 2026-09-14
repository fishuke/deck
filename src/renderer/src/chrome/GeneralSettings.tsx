import { useEffect, useState } from "react";
import { askModels, type DeckSettings, type OnMergeMode, type OnMergeSettings, type StartCwd } from "../../../shared/settings.js";
import { AgentSelect } from "../agents/AgentSelect.js";
import { BoardConnectionFields } from "./BoardConnectionFields.js";
import { Card, control, Field, Toggle } from "./settingsUi.js";
import type { BoardColumnStatuses } from "../../../main/board/types.js";
import { boardProviderLabels } from "../../../shared/board.js";

type Patch = Partial<DeckSettings>;

export function GeneralSettings() {
  const [settings, setSettings] = useState<DeckSettings>();
  const [columns, setColumns] = useState<BoardColumnStatuses[]>([]);
  const [columnsError, setColumnsError] = useState("");
  const connection = settings && JSON.stringify([settings.board.provider, settings.jira, settings.linear, settings.githubProjects]);
  useEffect(() => { void window.deck.getSettings().then(setSettings); }, []);
  useEffect(() => {
    if (connection === undefined) return;
    window.deck.board.columns()
      .then((fetched) => { setColumns(fetched); setColumnsError(fetched.length ? "" : "Fill in the connection to load the board's columns"); })
      .catch((error: unknown) => setColumnsError(`Could not load board columns: ${String(error)}`));
  }, [connection]);
  if (!settings) return null;
  const columnNames = columns.map((c) => c.name);
  const statusNames = [...new Set(columns.flatMap((c) => c.statuses.map((s) => s.name)))];

  const update = async (patch: Patch) => setSettings(await window.deck.updateSettings(patch));
  const updateBoard = (patch: Partial<DeckSettings["board"]>) => update({ board: { ...settings.board, ...patch } });
  const updateAutoFix = (patch: Partial<DeckSettings["autoFix"]>) => update({ autoFix: { ...settings.autoFix, ...patch } });
  const { onMerge } = settings.board;
  const tracker = boardProviderLabels[settings.board.provider];
  const updateOnMerge = (patch: Partial<OnMergeSettings>) => updateBoard({ onMerge: { ...onMerge, ...patch } });
  const onBlurText = (current: string, apply: (value: string) => void, fallback = "") => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value.trim() || fallback;
    if (v !== current) apply(v);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 font-sans">
      <div className="grid max-w-[1120px] grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Workspace" description="Where new sessions start, which agent answers by default and which model deck's own agent runs on.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default agent">
              <AgentSelect value={settings.defaultAgent} onChange={(defaultAgent) => void update({ defaultAgent })} />
            </Field>
            <Field label="Agent model (default)">
              <select aria-label="Agent model" className={`w-full ${control}`} value={settings.askModel}
                onChange={(e) => void update({ askModel: e.target.value })}>
                {askModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Start page">
              <select aria-label="Start page" className={`w-full ${control}`} value={settings.defaultView}
                onChange={(e) => void update({ defaultView: e.target.value as DeckSettings["defaultView"] })}>
                <option value="terminal">Terminal</option><option value="agent">Agent</option><option value="reviews">Reviews</option><option value="board">Board</option>
              </select>
            </Field>
          </div>
          <Field label="Default folder" hint="where terminals start when nothing else applies">
            <input placeholder="~" className={`w-full ${control}`} defaultValue={settings.defaultCwd}
              onBlur={onBlurText(settings.defaultCwd, (defaultCwd) => void update({ defaultCwd }), "~")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            {([["tab", "New tab starts in"], ["split", "Split pane starts in"]] as const).map(([action, label]) => (
              <Field key={action} label={label}>
                <select aria-label={label} className={`w-full ${control}`} value={settings.newTerminalCwd[action]}
                  onChange={(e) => void update({ newTerminalCwd: { ...settings.newTerminalCwd, [action]: e.target.value as StartCwd } })}>
                  <option value="current">Active terminal's folder</option>
                  <option value="default">Default folder</option>
                </select>
              </Field>
            ))}
          </div>
          <Field label="Repo roots" hint="searched by ⌘K and the repos fallback, one per line">
            <textarea rows={3} placeholder="~/www" className={`w-full resize-none ${control}`} defaultValue={settings.repoRoots.join("\n")}
              onBlur={(e) => {
                const roots = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                if (roots.join("\n") !== settings.repoRoots.join("\n")) void update({ repoRoots: roots });
              }} />
          </Field>
        </Card>

        <Card title="What deck may share with the agent" description="The agent page sends your question to Claude or Codex together with context about your work. This is what deck may include.">
          <Field label="Sessions">
            <select aria-label="Sessions shared with the agent" className={`w-full ${control}`} value={settings.agentSharing.mode}
              onChange={(e) => {
                const mode = e.target.value as DeckSettings["agentSharing"]["mode"];
                if (mode !== settings.agentSharing.mode) void update({ agentSharing: { ...settings.agentSharing, mode } });
              }}>
              <option value="all">Every live session, whichever project it is in</option>
              <option value="current">Only sessions in the project you are working in</option>
              <option value="allowlist">Only sessions in the projects listed below</option>
            </select>
          </Field>
          {settings.agentSharing.mode === "current" && (
            <p className="-mt-2 text-[11px] text-mut">The repository the active terminal tab is in. With no repository open, no session is shared.</p>
          )}
          {settings.agentSharing.mode === "allowlist" && (
            <Field label="Shared projects" hint="one directory per line; sessions inside them may be shared">
              <textarea rows={3} placeholder="~/www/my-app" className={`w-full resize-none ${control}`} defaultValue={settings.agentSharing.projects.join("\n")}
                onBlur={(e) => {
                  const projects = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                  if (projects.join("\n") !== settings.agentSharing.projects.join("\n")) void update({ agentSharing: { ...settings.agentSharing, projects } });
                }} />
            </Field>
          )}
          <Toggle checked={settings.agentSharing.transcripts} onChange={(transcripts) => void update({ agentSharing: { ...settings.agentSharing, transcripts } })}>Include the last messages of sessions waiting on you</Toggle>
          <Toggle checked={settings.agentSharing.board} onChange={(board) => void update({ agentSharing: { ...settings.agentSharing, board } })}>Include your issue board</Toggle>
          <Toggle checked={settings.agentSharing.pullRequests} onChange={(pullRequests) => void update({ agentSharing: { ...settings.agentSharing, pullRequests } })}>Include your pull request inbox</Toggle>
        </Card>

        <div className="flex flex-col gap-4">
        <Card title="Summon hotkey" description="Bring Deck up from anywhere with one keystroke.">
          <div className="flex items-center gap-3">
            <Toggle checked={settings.summonHotkeyEnabled} onChange={(summonHotkeyEnabled) => void update({ summonHotkeyEnabled })}>Enabled</Toggle>
            <button className="text-[11px] text-mut hover:text-soft" onClick={() => void update({ onboarded: false })}>run setup again</button>
            <input aria-label="Summon hotkey" title="Electron accelerator, e.g. Alt+Space" disabled={!settings.summonHotkeyEnabled} className={`ml-auto w-44 font-mono ${control} disabled:opacity-50`} defaultValue={settings.summonHotkey}
              onBlur={onBlurText(settings.summonHotkey, (summonHotkey) => void update({ summonHotkey }), settings.summonHotkey)} />
          </div>
          <Toggle checked={settings.summonDockToTop} disabled={!settings.summonHotkeyEnabled} onChange={(summonDockToTop) => void update({ summonDockToTop })}>Open as a quake panel docked to the top of the screen</Toggle>
          <div className={`ml-5 flex flex-col gap-3 border-l border-edge2 pl-4 ${settings.summonDockToTop && settings.summonHotkeyEnabled ? "" : "opacity-50"}`}>
            <Toggle checked={settings.summonHideOnBlur} disabled={!settings.summonDockToTop || !settings.summonHotkeyEnabled} onChange={(summonHideOnBlur) => void update({ summonHideOnBlur })}>Hide when another app takes focus</Toggle>
            <label className="flex items-center gap-3 text-xs text-dim">
              <span>Panel height</span>
              <span className="text-[11px] text-mut">a drag resize is kept until Deck quits</span>
              <span className="ml-auto flex items-center gap-1">
                <input type="number" min={20} max={100} disabled={!settings.summonDockToTop || !settings.summonHotkeyEnabled} className={`w-16 text-right ${control}`} defaultValue={Math.round(settings.summonHeightRatio * 100)}
                  onBlur={(e) => { const ratio = Math.min(100, Math.max(20, Number(e.target.value) || 60)) / 100; if (ratio !== settings.summonHeightRatio) void update({ summonHeightRatio: ratio }); }} />
                <span className="text-mut">%</span>
              </span>
            </label>
          </div>
        </Card>

        <Card title="Windows" description="Which window the hotkey and the Dock open, and what each one shows.">
          <Field label="Hotkey window">
            <select className={`w-full ${control}`} value={settings.windowMode}
              onChange={(e) => { const v = e.target.value as DeckSettings["windowMode"]; if (v !== settings.windowMode) void update({ windowMode: v }); }}>
              <option value="shared">Shared with the Dock window</option>
              <option value="panel">Separate window, same tabs</option>
              <option value="panel-own-tabs">Separate window, its own tabs</option>
            </select>
          </Field>
          <Toggle checked={settings.hideFromDock} onChange={(hideFromDock) => void update({ hideFromDock })}>Hide Deck from the Dock and Cmd-Tab</Toggle>
          <Toggle checked={settings.showTips} onChange={(showTips) => void update({ showTips })}>Show one-off tips about shortcuts you could use</Toggle>
        </Card>
        </div>

        <Card title="Auto-fix my pull requests" description="Start an agent automatically when one of my PRs breaks.">
          {([["enabled", "Auto-fix enabled"], ["ci", "…when CI fails"], ["conflicts", "…when it gets merge conflicts"]] as const).map(([field, text]) => (
            <Toggle key={field} checked={settings.autoFix[field]} disabled={field !== "enabled" && !settings.autoFix.enabled}
              onChange={(checked) => void updateAutoFix({ [field]: checked })}>{text}</Toggle>
          ))}
          <Field label="When the fix is ready">
            <select className={`w-full ${control}`} value={settings.autoFix.push}
              onChange={(e) => void updateAutoFix({ push: e.target.value as DeckSettings["autoFix"]["push"] })}>
              <option value="review">Show me the diff and wait for my approval before pushing</option>
              <option value="push">Commit and push without asking</option>
            </select>
          </Field>
        </Card>

        <Card title="GitHub" description="Scopes PR search to one owner. Leave empty to search all of GitHub.">
          <Field label="Owner">
            <input placeholder="your-org" className={`w-full ${control}`} defaultValue={settings.github.owner}
              onBlur={onBlurText(settings.github.owner, (owner) => void update({ github: { owner } }))} />
          </Field>
        </Card>

        <Card title="Board" description="Which tracker Deck mirrors, its credentials, and how the board's columns drive the reviews queue and merges." className="lg:col-span-2">
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            <div className="grid grid-cols-2 gap-4">
              <BoardConnectionFields settings={settings} onChange={(patch) => void update(patch)} />
              <Field label="Done column window" hint="days">
                <input type="number" min={1} className={`w-full ${control}`} defaultValue={settings.board.doneWindowDays}
                  onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 7); if (v !== settings.board.doneWindowDays) void updateBoard({ doneWindowDays: v }); }} />
              </Field>
            </div>
            <div className="flex flex-col gap-4">
              {columnsError && <div className="text-xs text-red">{columnsError}</div>}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Rejected status" hint="cards in this status are flagged">
                  <select className={`w-full ${control}`} value={settings.board.rejectedPattern} onChange={(e) => void updateBoard({ rejectedPattern: e.target.value })}>
                    {!statusNames.includes(settings.board.rejectedPattern) && <option value={settings.board.rejectedPattern}>{settings.board.rejectedPattern}</option>}
                    {statusNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </Field>
                <Field label="Review column" hint="PRs whose card sits here wait on you">
                  <select className={`w-full ${control}`} value={settings.board.reviewColumns[0] ?? ""} onChange={(e) => void updateBoard({ reviewColumns: e.target.value ? [e.target.value] : [] })}>
                    <option value="">All review requests</option>
                    {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </Field>
              </div>
              <Toggle checked={onMerge.enabled} onChange={(enabled) => void updateOnMerge({ enabled })}>Move the issue when its PR is merged from deck</Toggle>
              {onMerge.enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Move to">
                    <select className={`w-full ${control}`} value={onMerge.column} onChange={(e) => void updateOnMerge({ column: e.target.value })}>
                      <option value="">Pick a column…</option>
                      {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </Field>
                  <Field label="Where">
                    <select className={`w-full ${control}`} value={onMerge.mode} onChange={(e) => void updateOnMerge({ mode: e.target.value as OnMergeMode })}>
                      <option value="local">On deck's board only (until {tracker} catches up)</option>
                      <option value="remote">Move it in {tracker} too</option>
                    </select>
                  </Field>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
