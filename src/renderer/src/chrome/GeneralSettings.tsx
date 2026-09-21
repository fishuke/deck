import { useEffect, useState } from "react";
import { askModels, type DeckSettings, type StartCwd } from "../../../shared/settings.js";
import { AgentSelect } from "../agents/AgentSelect.js";
import { Card, control, Field, Toggle } from "./settingsUi.js";

type Patch = Partial<DeckSettings>;

// Settings about deck itself, shared by every workspace. The tracker, GitHub
// owner and folders are per workspace and live in WorkspaceSettings.

export function GeneralSettings() {
  const [settings, setSettings] = useState<DeckSettings>();
  useEffect(() => { void window.deck.getSettings().then(setSettings); return window.deck.onSettingsChanged(setSettings); }, []);
  if (!settings) return null;

  const update = async (patch: Patch) => setSettings(await window.deck.updateSettings(patch));
  const updateAutoFix = (patch: Partial<DeckSettings["autoFix"]>) => update({ autoFix: { ...settings.autoFix, ...patch } });
  const onBlurText = (current: string, apply: (value: string) => void, fallback = "") => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value.trim() || fallback;
    if (v !== current) apply(v);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 font-sans">
      <div className="grid max-w-[1120px] grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Sessions" description="Which agent answers by default, which model deck's own agent runs on and where new terminals start.">
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
          <div className="grid grid-cols-2 gap-4">
            {([["tab", "New tab starts in"], ["split", "Split pane starts in"]] as const).map(([action, label]) => (
              <Field key={action} label={label}>
                <select aria-label={label} className={`w-full ${control}`} value={settings.newTerminalCwd[action]}
                  onChange={(e) => void update({ newTerminalCwd: { ...settings.newTerminalCwd, [action]: e.target.value as StartCwd } })}>
                  <option value="current">Active terminal's folder</option>
                  <option value="default">Workspace default folder</option>
                </select>
              </Field>
            ))}
          </div>
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

        <Card title="Experiments" description="Features still being tried out. Each is off until you switch it on.">
          <Toggle checked={settings.experiments.sessionSweep} onChange={(sessionSweep) => void update({ experiments: { ...settings.experiments, sessionSweep } })}>
            Session sweep: a broom in the sidebar lists the pull requests each agent session opened and closes the sessions whose work is merged
          </Toggle>
        </Card>

      </div>
    </div>
  );
}
