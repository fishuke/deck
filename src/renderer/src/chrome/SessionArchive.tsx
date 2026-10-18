import { useEffect, useMemo, useRef, useState } from "react";
import { baseName } from "../../../shared/platform.js";
import { agentLabels } from "../../../shared/agents.js";
import type { AgentSession } from "../../../main/sessions.js";
import { archiveGroups } from "../lib/sessionArchive.js";
import { shortPath } from "../lib/useGitSummary.js";
import { Icon } from "../board/icons.js";
import { SessionIcon, statusLabels } from "./SessionIcon.js";

// Arc's Archived Tabs, for sessions: swipe right on the sidebar and every
// session deck has ever seen slides in, newest first, one click from resuming.

export function SessionArchive({ sessions, onResume, onClose }: {
  sessions: AgentSession[];
  onResume: (session: AgentSession) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [agentsOnly, setAgentsOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const groups = useMemo(() => {
    const pool = agentsOnly ? sessions.filter((session) => session.agent) : sessions;
    return archiveGroups(pool, query);
  }, [sessions, query, agentsOnly]);

  return <div role="dialog" aria-label="Session archive" className="view-enter absolute inset-0 z-50 flex flex-col bg-panel">
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
      <Icon name="search" size={12} className="text-mut" />
      <input ref={inputRef} aria-label="Search archive" placeholder="Search archive…" value={query} onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-soft outline-none placeholder:text-dim" />
      <button aria-label="Only agent sessions" aria-pressed={agentsOnly} title="Filter: agent sessions" onClick={() => setAgentsOnly(!agentsOnly)}
        className={agentsOnly ? "text-accent" : "text-mut hover:text-ink"}><Icon name="sparkle" size={14} /></button>
      <button aria-label="Close archive" title="Close archive" onClick={onClose} className="text-mut hover:text-ink"><Icon name="x" size={12} /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      {groups.map((group) => <section key={group.label} aria-label={group.label}>
        <div className="px-4 pb-1 pt-4 text-[10px] tracking-widest text-dim">{group.label.toUpperCase()}</div>
        {group.sessions.map((session) => <button key={session.session_id} onClick={() => onResume(session)}
          title={`${session.title || session.cwd} · ${statusLabels[session.status]}`}
          className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left hover:bg-card">
          <SessionIcon agent={session.agent} status={session.status} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-body">{session.title || baseName(session.cwd)}</span>
            <span className="block truncate text-[10px] text-dim">{session.issue_key ? `${session.issue_key} · ` : ""}{agentLabels[session.agent]} · {shortPath(session.cwd)}</span>
          </span>
          <span className="shrink-0 self-start pt-1 text-[10px] text-dim">{new Date(session.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </button>)}
      </section>)}
      {!groups.length && <div className="p-4 text-xs text-dim">{query.trim() ? "No matching sessions" : "No sessions yet"}</div>}
    </div>
  </div>;
}
