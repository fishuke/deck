import { useEffect, useRef, useState } from "react";
import { shellArg } from "../../../shared/platform.js";
import type { InstalledVersions, ProjectRuntime } from "../../../main/projectRuntime.js";
import { shortPath, useGitSummary } from "../lib/useGitSummary.js";
import { Icon, type IconName } from "../board/icons.js";
import { terminalAction } from "./actions.js";

// Where the terminal is and what state it is in — runtime, folder, branch and
// working-tree diff — kept above the output, and clickable: each chip opens
// the choices it has and runs the switch in the shell itself, so the change is
// visible in the scrollback and outlives the click.

type MenuKind = "runtime" | "folder" | "branch";

interface MenuItem {
  label: string;
  /** Shell command the pick runs. */
  command: string;
  current?: boolean;
}


export function ContextBar({ termId, cwd, busy = false }: { termId: string; cwd?: string; busy?: boolean }) {
  const git = useGitSummary(cwd);
  const [runtime, setRuntime] = useState<ProjectRuntime | null>(null);
  const [versions, setVersions] = useState<InstalledVersions | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [menu, setMenu] = useState<MenuKind>();

  useEffect(() => {
    setRuntime(null); setVersions(null); setBranches([]); setFolders([]);
    if (!cwd) return;
    let cancelled = false;
    const load = <T,>(read: Promise<T>, apply: (value: T) => void) =>
      void read.then((value) => { if (!cancelled) apply(value); }).catch(() => {});
    load(window.deck.project.runtime(cwd), setRuntime);
    load(window.deck.project.versions(cwd), setVersions);
    load(window.deck.git.branches(cwd), setBranches);
    load(window.deck.files.list(cwd), (entries) => setFolders(entries.filter((entry) => entry.directory).map((entry) => entry.name)));
    return () => { cancelled = true; };
  }, [cwd]);

  const items: Record<MenuKind, MenuItem[]> = {
    runtime: (versions?.versions ?? []).map((version) => ({ label: version, command: `${versions?.manager} use ${version}`, current: version === runtime?.version })),
    folder: [{ label: "‥ parent folder", command: "cd .." }, ...folders.map((folder) => ({ label: folder, command: `cd ${shellArg(folder)}` }))],
    branch: branches.map((branch) => ({ label: branch, command: `git checkout ${shellArg(branch)}`, current: branch === git?.branch })),
  };

  const run = (command: string) => {
    setMenu(undefined);
    window.deck.term.input(termId, `${command}\r`);
  };

  // A pick is typed into the shell, so it can only be offered at a prompt:
  // with an agent or any other program in the foreground it would land in that
  // program's input instead.
  const menuOf = (heading: string, kind: MenuKind) => !busy && items[kind].length ? heading : undefined;
  const titleOf = (action: string) => busy ? "The terminal is running something — nothing to type into" : action;

  return <div className="mb-2 flex shrink-0 items-center gap-2 font-sans text-[11px] text-mut">
    {runtime && <Chip label={`${runtime.label} ${runtime.version}`} title={titleOf(`Change ${runtime.label} version`)}
      menu={menuOf("Installed", "runtime")} open={menu === "runtime"} onOpen={setMenu} kind="runtime" items={items.runtime} onPick={run} />}
    <Chip icon="folder" label={shortPath(cwd)} title={titleOf("Change folder")} menu={menuOf("Folders here", "folder")} open={menu === "folder"} onOpen={setMenu} kind="folder" items={items.folder} onPick={run} search />
    {git && <Chip icon="branch" label={git.branch} title={titleOf("Change git branch")} menu={menuOf("Branches", "branch")} open={menu === "branch"} onOpen={setMenu} kind="branch" items={items.branch} onPick={run} search />}
    {git && Boolean(git.changedFiles) && <button title="Review working-tree changes" onClick={() => terminalAction("changes")} className="flex items-center gap-1.5 rounded border border-edge2 bg-card px-2 py-0.5 hover:text-soft">
      <Icon name="file" size={11} />{git.changedFiles}<span className="text-dim">•</span><span className="text-green">+{git.added}</span><span className="text-red">−{git.removed}</span>
    </button>}
  </div>;
}

function Chip({ icon, label, title, menu, kind, items, open, onOpen, onPick, search = false }: {
  icon?: IconName;
  label: string;
  title: string;
  /** Heading of the menu this chip opens; without one the chip is just a label. */
  menu?: string;
  kind: MenuKind;
  items: MenuItem[];
  open: boolean;
  onOpen: (kind?: MenuKind) => void;
  onPick: (command: string) => void;
  search?: boolean;
}) {
  const [query, setQuery] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const dismiss = (event: MouseEvent) => { if (!host.current?.contains(event.target as Node)) onOpen(undefined); };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open, onOpen]);

  const shown = items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  const content = <>{icon && <Icon name={icon} size={11} />}<span className="truncate">{label}</span></>;
  if (!menu) return <span title={title} className="flex min-w-0 items-center gap-1.5 rounded border border-edge2 bg-card px-2 py-0.5">{content}</span>;

  return <div ref={host} className="relative min-w-0">
    <button title={title} aria-expanded={open} onClick={() => onOpen(open ? undefined : kind)} onKeyDown={(event) => { if (event.key === "Escape") onOpen(undefined); }}
      className="flex min-w-0 items-center gap-1.5 rounded border border-edge2 bg-card px-2 py-0.5 hover:text-soft">{content}</button>
    {open && <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-edge3 bg-overlay py-1 shadow-lg">
      {search && <input aria-label={`Search ${menu.toLowerCase()}`} autoFocus placeholder="Search…" value={query} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") onOpen(undefined); if (event.key === "Enter" && shown[0]) onPick(shown[0].command); }}
        className="mb-1 w-full bg-transparent px-3 py-1 text-soft outline-none placeholder:text-dim" />}
      <div className="px-3 py-0.5 text-dim">{menu}</div>
      {shown.map((item) => <button key={item.label} onClick={() => onPick(item.command)}
        className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-card2 ${item.current ? "text-soft" : ""}`}>
        <span className="w-3">{item.current ? "✓" : ""}</span><span className="truncate">{item.label}</span>
      </button>)}
      {!shown.length && <div className="px-3 py-1 text-dim">Nothing to pick</div>}
    </div>}
  </div>;
}
