import { useEffect, useRef, useState } from "react";
import type { AgentSession } from "../../../main/sessions.js";
import { Icon } from "../board/icons.js";
import { askModels } from "../../../shared/settings.js";
import { AgentSelect } from "./AgentSelect.js";
import { useChat } from "./ChatStore.js";
import { ChatTurns } from "./ChatTurns.js";
import { project } from "./attention.js";

// The conversation with deck's agent. Answers come from a headless agent turn
// that is handed the live sessions, PR inbox and issue board, plus deck's MCP
// tools, so it can start agents, steer them and act on PRs from here.

const EXAMPLES: { title: string; hint: string; prompt: string }[] = [
  { title: "PRs to review", hint: "Which pull requests are waiting on my review?", prompt: "Which PRs need my review? List them with repo, title and how long they have waited." },
  { title: "My PRs needing attention", hint: "Rejected, CI failing or conflicting", prompt: "Do any of my PRs need my attention: changes requested, CI failing or merge conflicts? Tell me which already have a fix agent on them." },
  { title: "Agents needing me", hint: "Sessions waiting for an answer or a review", prompt: "Which agents need my attention, and what does each one need from me?" },
  { title: "Plan the next epic", hint: "Turn a goal into small, shippable tasks", prompt: "Let's plan our next epic. Look at the open epics and backlog first, then ask me what the goal is." },
  { title: "Find a task to fix now", hint: "A small backlog item with a local checkout", prompt: "Find a task in the backlog that we can fix right now: small, well described, with a repo I have checked out. Explain your pick and offer to start an agent on it." },
];

const label = (s: AgentSession): string => s.title ?? project(s.cwd);

/** `compact` fits the chat into the dock popover instead of the full page. */
export function AgentChat({ sessions, compact = false, headline }: { sessions: AgentSession[]; compact?: boolean; headline?: React.ReactNode }) {
  const { turns, busy, agent, chooseAgent, model, setModel, ask, note, replyTo, setReplyTo } = useChat();
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [turns]);

  useEffect(() => {
    if (replyTo && !sessions.some((s) => s.session_id === replyTo.session_id)) setReplyTo(undefined);
  }, [sessions, replyTo, setReplyTo]);

  useEffect(() => { if (replyTo) input.current?.focus(); }, [replyTo]);

  const send = (question: string) => { setDraft(""); void ask(question); };

  // The reply arrives as one paste; Enter has to be its own keystroke or the
  // agent's input folds it into the pasted text instead of submitting.
  const reply = (session: AgentSession, text: string) => {
    const term = session.term_id;
    if (!term || !text.trim()) return;
    window.deck.term.input(term, `\x1b[200~${text}\x1b[201~`);
    setTimeout(() => window.deck.term.input(term, "\r"), 200);
    setDraft("");
    note(`→ ${label(session)}: ${text}`);
    setReplyTo(undefined);
  };

  const submit = () => (replyTo ? reply(replyTo, draft) : send(draft));
  const empty = turns.length === 0;
  const gutter = compact ? "px-4" : "px-8";

  const composer = (
    <div className={`rounded-xl border border-edge2 bg-card ${empty ? "shadow-[0_0_0_1px_rgba(167,139,250,0.08)]" : ""}`}>
      {replyTo && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-[11px] text-accent">
          <span className="truncate">replying to {label(replyTo)}</span>
          <button onClick={() => setReplyTo(undefined)} className="text-dim hover:text-ink" aria-label="Stop replying"><Icon name="x" size={10} /></button>
        </div>
      )}
      <textarea
        ref={input}
        aria-label="Ask deck"
        value={draft}
        rows={empty ? 2 : 2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder={replyTo ? `answer ${label(replyTo)}…` : busy ? "deck is working…" : "Ask deck…"}
        disabled={busy && !replyTo}
        className="w-full resize-none bg-transparent px-4 pt-3.5 text-[13px] text-ink placeholder:text-dim focus:outline-none disabled:opacity-50"
      />
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <fieldset disabled={busy} className="flex items-center gap-2">
          <AgentSelect value={agent} onChange={chooseAgent} />
          {agent === "claude" && (
            <select aria-label="Model" title="Model for deck's agent. Sonnet for everyday questions; pick a bigger model to plan an epic." value={model} onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-edge2 bg-card px-2 py-1 text-[11px] text-body outline-none">
              {askModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
        </fieldset>
        <button aria-label="Send" title="Send (Enter)" disabled={(busy && !replyTo) || !draft.trim()} onClick={submit}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-accent text-bg disabled:opacity-30">↑</button>
      </div>
    </div>
  );

  if (empty) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto ${gutter} ${compact ? "py-4" : "py-10"}`}>
        <div className="w-full max-w-[760px]">
          {!compact && headline && <div className="mb-6">{headline}</div>}
          {composer}
          <div className="mt-5 text-[11px] text-mut">Get started with some examples</div>
          {compact ? (
            <div className="mt-2 flex flex-col">
              {EXAMPLES.map((e) => (
                <button key={e.title} aria-label={e.title} onClick={() => send(e.prompt)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-body hover:bg-card hover:text-ink">
                  <Icon name="sparkle" size={11} className="text-accent" />{e.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e.title} aria-label={e.title} title={e.hint} onClick={() => send(e.prompt)}
                  className="flex items-center gap-1.5 rounded-full border border-edge2 px-3 py-1.5 text-[12px] text-body hover:border-edge3 hover:text-ink">
                  <Icon name="sparkle" size={10} className="text-accent" />{e.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${gutter} py-6`}>
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
          <ChatTurns turns={turns} />
        </div>
      </div>
      <div className={`${gutter} pb-5`}><div className="mx-auto w-full max-w-[760px]">{composer}</div></div>
    </div>
  );
}
