import { useCallback, useEffect, useState } from "react";
import { agentLabels } from "../../../shared/agents.js";
import type { AgentSession } from "../../../main/sessions.js";
import type { IssuePr } from "../../../main/github.js";
import { Icon } from "../board/icons.js";
import { SessionIcon, statusLabels } from "./SessionIcon.js";
import { sweepLabel, sweepVerdict, type SweepFacts } from "../lib/sessionSweep.js";
import { useTabs, type TermTab } from "../store.js";

// Sessions whose work has landed pile up in the sidebar the way worktrees do
// on disk. This is where they surface: every live agent tab with the pull
// requests it opened, and the done ones — idle, every PR merged, nothing
// uncommitted — offered together as the safe ones to close.

export interface SweepRow {
  tab: TermTab;
  session: AgentSession;
}

interface Checked {
  prs: IssuePr[];
  dirtyFiles: number;
}

const prLabel = (pr: IssuePr) => pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";

export function SessionSweep({ rows, onClose }: { rows: SweepRow[]; onClose: () => void }) {
  const { closeTab } = useTabs();
  const [checked, setChecked] = useState<Record<string, Checked>>({});
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    setScanning(true);
    // The tab's folder is where the agent works; the session's is where it started.
    await Promise.all(rows.map(async ({ tab, session }) => {
      const [prs, git] = await Promise.all([
        window.deck.sessions.pullRequests(session.session_id, fresh).catch(() => []),
        window.deck.git.summary(tab.cwd || session.cwd).catch(() => null),
      ]);
      setChecked((prev) => ({ ...prev, [tab.termId]: { prs, dirtyFiles: git?.changedFiles ?? 0 } }));
    }));
    setScanning(false);
  }, [rows]);
  // Rows only ever leave while this is open (closing tabs), so one scan covers them.
  useEffect(() => { void load(false); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const facts = (row: SweepRow): SweepFacts | undefined => {
    const result = checked[row.tab.termId];
    return result && { status: row.session.status, ...result };
  };
  const done = rows.filter((row) => { const f = facts(row); return f && sweepVerdict(f) === "done"; });

  return <div role="dialog" aria-label="Session sweep" className="view-enter absolute inset-0 z-50 flex flex-col bg-panel">
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
      <Icon name="broom" size={12} className="text-mut" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-soft">Session sweep</span>
      <button disabled={scanning} onClick={() => { setChecked({}); void load(true); }}
        className="shrink-0 text-[11px] text-dim hover:text-ink disabled:opacity-40">↻ rescan</button>
      <button aria-label="Close session sweep" title="Close" onClick={onClose}
        className="text-mut hover:text-ink"><Icon name="x" size={12} /></button>
    </div>

    {done.length > 1 && <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
      <span className="min-w-0 flex-1 text-[11px] text-mut">{done.length} merged and clean</span>
      <button onClick={() => done.forEach((row) => closeTab(row.tab.termId))}
        className="shrink-0 rounded-md border border-edge3 px-2 py-1 text-[10px] text-soft hover:bg-card">
        Close all done
      </button>
    </div>}

    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      {rows.length === 0 && <div className="p-4 text-xs text-dim">No agent sessions open.</div>}
      {rows.map((row) => {
        const { tab, session } = row;
        const title = tab.customTitle || session.title || tab.title;
        const f = facts(row);
        const verdict = f && sweepVerdict(f);
        return <div key={tab.termId} className="border-b border-edge/80 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <SessionIcon agent={session.agent} status={session.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] text-soft" title={title}>{title}</span>
              <span className="mt-0.5 block truncate text-[10px] text-dim">{agentLabels[session.agent]} · {statusLabels[session.status]}</span>
            </span>
          </div>
          <div className="mt-1.5 flex flex-col gap-0.5 pl-7 text-[10px]">
            {!f && <span className="text-dim">checking pull requests…</span>}
            {f?.prs.map((pr) => <span key={pr.url} className="flex min-w-0 items-center gap-1.5">
              <span className={`shrink-0 ${pr.state === "MERGED" ? "text-dim" : "text-orange"}`}>{prLabel(pr)}</span>
              <a href={pr.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-soft hover:underline" title={pr.url}>#{pr.number} {pr.title}</a>
            </span>)}
          </div>
          {f && verdict && <div className="mt-1.5 flex items-center gap-2 pl-7 text-[10px]">
            <span className={verdict === "done" ? "text-dim" : "text-orange"}>{sweepLabel(verdict, f)}</span>
            <button aria-label={`Close session ${title}`} onClick={() => closeTab(tab.termId)}
              className="ml-auto shrink-0 rounded border border-edge3 px-1.5 py-0.5 text-soft hover:bg-card">
              Close
            </button>
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
