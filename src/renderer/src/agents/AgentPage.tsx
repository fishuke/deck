import { useEffect, useState } from "react";
import type { AgentSession } from "../../../main/sessions.js";
import { statusTones } from "../chrome/SessionIcon.js";
import { agentLabels } from "../../../shared/agents.js";
import { Icon } from "../board/icons.js";
import { useAgentSessions } from "../lib/useSessions.js";
import { useTabs } from "../store.js";
import { AgentChat } from "./AgentChat.js";
import { useChat } from "./ChatStore.js";
import { isWaiting, project, useAttentionCount } from "./attention.js";

// The agent page: deck's orchestrator front and centre (like Linear's Agent
// view), with a rail of waiting sessions and every live session.

const statusWord: Record<AgentSession["status"], string> = {
  working: "running", needs_input: "needs input", needs_review: "needs review", idle: "idle", ended: "done",
};

function ago(iso: string | number): string {
  const m = Math.round((Date.now() - (typeof iso === "number" ? iso : Date.parse(iso))) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  return m < 60 * 24 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5 px-4 py-3">
      <h3 className="flex items-center gap-2 text-[10px] tracking-widest text-dim">{title.toUpperCase()}<span className="text-mut">{count}</span></h3>
      {children}
    </section>
  );
}

export function AgentPage({ visible }: { visible: boolean }) {
  const { newTab, tabs, focusTab } = useTabs();
  const sessions = useAgentSessions();
  const { turns, reset, setReplyTo } = useChat();
  const [rail, setRail] = useState(() => localStorage.getItem("deck.agent.rail") !== "hidden");

  const toggleRail = () => setRail((open) => { localStorage.setItem("deck.agent.rail", open ? "hidden" : "visible"); return !open; });

  // How many sessions the next question will carry, refreshed when the
  // sessions or the setting change.
  const [shared, setShared] = useState<{ shared: number; total: number }>();
  useEffect(() => {
    void window.deck.sharing.summary().then(setShared);
    return window.deck.onSettingsChanged(() => void window.deck.sharing.summary().then(setShared));
  }, [sessions]);

  const live = sessions.filter((s) => s.status !== "ended");
  const waiting = live.filter(isWaiting);
  const attention = useAttentionCount();
  const open = new Set(tabs.map((t) => t.termId));
  const openSession = (s: AgentSession) => s.term_id && open.has(s.term_id) ? focusTab(s.term_id) : void newTab({ cwd: s.cwd, agent: s.agent, sessionId: s.session_id });

  return (
    <div className={`${visible ? "flex" : "hidden"} min-h-0 min-w-0 flex-1`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-edge px-6 py-3">
          <Icon name="sparkle" className="text-accent" />
          <span className="font-bold text-ink">Agent</span>
          {turns.length > 0 && <button onClick={reset} className="rounded-md border border-edge2 px-2 py-0.5 text-[11px] text-body hover:text-ink">New chat</button>}
          <span className="ml-auto text-[11px] text-dim">
            {shared && shared.shared < shared.total && (
              <span title="Restricted in Settings → What deck may share with the agent" className="mr-2 text-orange">sharing {shared.shared} of {shared.total} sessions</span>
            )}
            {live.filter((s) => s.status === "working").length} running · {attention} need you
          </span>
          <button onClick={toggleRail} aria-pressed={rail} aria-label="Toggle agent rail" title="Sessions and pull requests" className={`rounded p-1 ${rail ? "bg-card2 text-soft" : "text-dim hover:text-ink"}`}><Icon name="sidebar" size={14} /></button>
        </div>
        <AgentChat sessions={live} />
      </div>

      {rail && (
        <section aria-label="Agent rail" className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-edge bg-panel">
          {attention > 0 && (
            <Section title="Needs you" count={attention}>
              {waiting.map((s) => (
                <div key={s.session_id} className="flex flex-col gap-0.5 rounded-lg border border-orange/30 bg-card px-3 py-2 hover:border-orange/60">
                  <button onClick={() => openSession(s)} className="flex flex-col gap-0.5 text-left">
                    <span className="truncate text-[11px] text-ink">{s.title ?? project(s.cwd)}</span>
                    <span className="text-[10px] text-orange">{statusWord[s.status]} · {agentLabels[s.agent]} · {project(s.cwd)}</span>
                    {s.review_note && <span className="line-clamp-2 text-[10px] text-dim">{s.review_note}</span>}
                  </button>
                  {s.term_id && <button onClick={() => setReplyTo(s)} className="self-start text-[10px] text-dim hover:text-accent">Reply from here</button>}
                </div>
              ))}
            </Section>
          )}
          <Section title="Sessions" count={live.length}>
            {live.length === 0 && <span className="text-[11px] text-dim">No agent sessions yet — run <span className="text-soft">claude</span> or <span className="text-soft">codex</span> in a terminal, or ask deck to start one.</span>}
            {live.filter((s) => !isWaiting(s)).map((s) => {
              const r = statusTones[s.status];
              return (
                <button key={s.session_id} onClick={() => openSession(s)} className="flex items-center gap-2.5 rounded-lg border border-edge2 bg-card px-3 py-2 text-left hover:border-edge3">
                  <span className={`w-3 ${r.text}`}>{r.glyph}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-ink">{s.title ?? project(s.cwd)}</span>
                    <span className="block text-[10px] text-dim">{agentLabels[s.agent]} · {project(s.cwd)} · {ago(s.updated_at)}</span>
                  </span>
                  <span className={`text-[10px] ${r.text}`}>{statusWord[s.status]}</span>
                </button>
              );
            })}
          </Section>
        </section>
      )}
    </div>
  );
}
