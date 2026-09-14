import { useEffect, useState } from "react";
import { defaultWorkspaceSettings, type DeckSettings, type OnMergeMode, type OnMergeSettings, type Workspace } from "../../../shared/settings.js";
import { BoardConnectionFields } from "./BoardConnectionFields.js";
import { Card, control, Field, Toggle } from "./settingsUi.js";
import type { BoardColumnStatuses } from "../../../main/board/types.js";
import { boardProviderLabels } from "../../../shared/board.js";

type Patch = Partial<DeckSettings>;

// The settings that belong to a workspace: its tracker, GitHub owner and
// folders. Everything about deck itself is in GeneralSettings.

/** The workspace list: pick the active one, rename it, add or remove one.
 *  Removing the active workspace makes the first remaining one active. */
function WorkspaceList({ settings, update }: { settings: DeckSettings; update: (patch: Patch) => void }) {
  const { workspaces, activeWorkspace } = settings;
  const active = workspaces.find((w) => w.id === activeWorkspace) ?? workspaces[0];
  const add = () => {
    const workspace: Workspace = { id: crypto.randomUUID(), name: `Workspace ${workspaces.length + 1}`, ...defaultWorkspaceSettings };
    update({ workspaces: [...workspaces, workspace], activeWorkspace: workspace.id });
  };
  const rename = (name: string) => update({ workspaces: workspaces.map((w) => (w.id === active.id ? { ...w, name } : w)) });
  const remove = () => update({ workspaces: workspaces.filter((w) => w.id !== active.id) });
  return (
    <Card title="Workspaces" description="One per client or company. Each has its own tracker, GitHub owner, folders and terminal sessions; the settings below belong to the active one." className="lg:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        {workspaces.map((w) => (
          <button key={w.id} aria-pressed={w.id === active.id} onClick={() => update({ activeWorkspace: w.id })}
            className={`rounded-md border px-3 py-1.5 text-xs ${w.id === active.id ? "border-accent bg-card2 text-soft" : "border-edge2 text-mut hover:text-soft"}`}>{w.name}</button>
        ))}
        <button onClick={add} className="rounded-md border border-dashed border-edge2 px-3 py-1.5 text-xs text-mut hover:text-soft">+ Add workspace</button>
      </div>
      <div className="flex items-end gap-3">
        <Field label="Name">
          <input key={active.id} aria-label="Workspace name" className={`w-56 ${control}`} defaultValue={active.name}
            onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== active.name) rename(name); }} />
        </Field>
        <button disabled={workspaces.length < 2} onClick={remove} className="mb-0.5 text-xs text-red disabled:opacity-40">Remove {active.name}</button>
      </div>
    </Card>
  );
}

export function WorkspaceSettings() {
  const [settings, setSettings] = useState<DeckSettings>();
  const [columns, setColumns] = useState<BoardColumnStatuses[]>([]);
  const [columnsError, setColumnsError] = useState("");
  const connection = settings && JSON.stringify([settings.activeWorkspace, settings.board.provider, settings.jira, settings.linear, settings.githubProjects]);
  // A workspace switch from the titlebar or ⌘K must show up here too.
  useEffect(() => { void window.deck.getSettings().then(setSettings); return window.deck.onSettingsChanged(setSettings); }, []);
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
  const { onMerge } = settings.board;
  const tracker = boardProviderLabels[settings.board.provider];
  const updateOnMerge = (patch: Partial<OnMergeSettings>) => updateBoard({ onMerge: { ...onMerge, ...patch } });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 font-sans">
      {/* Every text field is uncontrolled; a switch remounts them with the new workspace's values. */}
      <div key={settings.activeWorkspace} className="grid max-w-[1120px] grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkspaceList settings={settings} update={(patch) => void update(patch)} />

        <Card title="Folders" description="Where this workspace's code lives.">
          <Field label="Default folder" hint="where terminals start when nothing else applies">
            <input placeholder="~" className={`w-full ${control}`} defaultValue={settings.defaultCwd}
              onBlur={(e) => { const defaultCwd = e.target.value.trim() || "~"; if (defaultCwd !== settings.defaultCwd) void update({ defaultCwd }); }} />
          </Field>
          <Field label="Repo roots" hint="searched by ⌘K and the repos fallback, one per line">
            <textarea rows={3} placeholder="~/www" className={`w-full resize-none ${control}`} defaultValue={settings.repoRoots.join("\n")}
              onBlur={(e) => {
                const roots = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                if (roots.join("\n") !== settings.repoRoots.join("\n")) void update({ repoRoots: roots });
              }} />
          </Field>
        </Card>

        <Card title="GitHub" description="Scopes the PR inbox and PR search to one owner, or to a few of its repositories. Leave both empty to search all of GitHub.">
          <Field label="Owner">
            <input placeholder="your-org" className={`w-full ${control}`} defaultValue={settings.github.owner}
              onBlur={(e) => { const owner = e.target.value.trim(); if (owner !== settings.github.owner) void update({ github: { ...settings.github, owner } }); }} />
          </Field>
          <Field label="Repositories" hint="one per line, names under the owner or owner/name; empty means all of the owner's">
            <textarea rows={3} placeholder="deck" className={`w-full resize-none ${control}`} defaultValue={settings.github.repos.join("\n")}
              onBlur={(e) => {
                const repos = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                if (repos.join("\n") !== settings.github.repos.join("\n")) void update({ github: { ...settings.github, repos } });
              }} />
          </Field>
        </Card>

        <Card title="Board" description="Which tracker Deck mirrors, its credentials, and how its columns drive the reviews queue and merges." className="lg:col-span-2">
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
                <Field label="Reviews queue" hint="where the reviews page gets its PRs">
                  <select className={`w-full ${control}`} value={settings.reviewSource}
                    onChange={(e) => void update({ reviewSource: e.target.value as DeckSettings["reviewSource"] })}>
                    <option value="github">Every PR GitHub asks me to review</option>
                    <option value="board">The PRs of a {tracker} column</option>
                  </select>
                </Field>
                {settings.reviewSource === "board" && (
                  <Field label="Review column" hint="every card here puts its PRs in the queue">
                    <select className={`w-full ${control}`} value={settings.board.reviewColumns[0] ?? ""} onChange={(e) => void updateBoard({ reviewColumns: e.target.value ? [e.target.value] : [] })}>
                      <option value="">Pick a column…</option>
                      {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </Field>
                )}
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
