import { useEffect, useRef, useState } from "react";
import { primaryHint } from "../../../shared/keybinds.js";
import type { PrComment } from "../../../main/github.js";
import type { ReviewDraft } from "../../../main/review.js";
import { Icon } from "./icons.js";
import { Markdown } from "./Markdown.js";
import { Avatar, relativeTime } from "./prUi.js";

export interface ThreadActions {
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onResolve: (threadId: string, resolved: boolean) => void;
}

/** Textarea + send button; ⌘↵ (Ctrl+↵ off the Mac) sends, Esc cancels. Shared by every composer here. */
function TextBox({
  placeholder,
  sendLabel,
  autoFocus,
  onSend,
  onCancel,
  rows = 2,
  tone = "accent",
}: {
  placeholder: string;
  sendLabel: string;
  autoFocus?: boolean;
  onSend: (body: string) => Promise<boolean> | void;
  onCancel?: () => void;
  rows?: number;
  tone?: "accent" | "red";
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const send = async () => {
    const body = ref.current?.value.trim();
    if (!body || busy) return;
    setBusy(true);
    const ok = (await onSend(body)) !== false;
    setBusy(false);
    if (ok && ref.current) ref.current.value = "";
  };
  return (
    <div>
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel?.();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
        className={`w-full resize-y rounded border border-edge2 bg-bg px-2 py-1.5 font-sans text-[11px] text-body outline-none ${
          tone === "red" ? "focus:border-red" : "focus:border-accent"
        }`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => void send()}
          disabled={busy}
          className={`rounded-md border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
            tone === "red"
              ? "border-red/40 text-red hover:bg-red/10"
              : "border-accent/40 text-accent hover:border-accent"
          }`}
        >
          {busy ? "sending…" : sendLabel} <span className="opacity-60">{primaryHint}↵</span>
        </button>
        {onCancel && (
          <button onClick={onCancel} className="px-2 py-1 text-[11px] text-dim hover:text-ink">
            cancel
          </button>
        )}
      </div>
    </div>
  );
}

export { TextBox };

/** One review thread (or a single top-level comment) as a card, GitHub-style.
 *  Resolved and outdated threads start collapsed, like GitHub; any thread
 *  folds to a one-line summary from its header. */
export function ThreadCard({
  comments,
  actions,
}: {
  comments: PrComment[];
  actions?: ThreadActions;
}) {
  const first = comments[0];
  const settled = first.resolved || first.outdated;
  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(settled);
  const summary = first.body.replace(/\s+/g, " ").trim();
  return (
    <div
      className={`mx-2 my-1.5 rounded-lg border bg-card ${
        settled ? "border-edge2 opacity-60" : "border-edge3"
      }`}
    >
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label={`Expand thread by ${first.author}`}
          className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[11px] hover:bg-card2"
        >
          <Icon name="chevronRight" size={11} className="text-dim" />
          <Avatar name={first.author} />
          <span className="font-semibold text-soft">{first.author}</span>
          {first.resolved && <span className="text-green">resolved</span>}
          {first.outdated && !first.resolved && <span className="text-dim">outdated</span>}
          <span className="min-w-0 flex-1 truncate text-mut">{summary}</span>
          {comments.length > 1 && <span className="shrink-0 text-dim">{comments.length} comments</span>}
        </button>
      ) : (
        <>
          {comments.map((comment, i) => (
            <div key={comment.id} className={`px-3 py-2 ${i > 0 ? "border-t border-edge" : ""}`}>
              <div className="flex items-center gap-2 font-sans text-[11px]">
                {i === 0 && (
                  <button
                    onClick={() => setCollapsed(true)}
                    aria-expanded
                    aria-label={`Collapse thread by ${comment.author}`}
                    title="Collapse thread"
                    className="text-dim hover:text-ink"
                  >
                    <Icon name="chevronDown" size={11} />
                  </button>
                )}
                <Avatar name={comment.author} />
                <span className="font-semibold text-soft">{comment.author}</span>
                {comment.isBot && <span className="rounded bg-card2 px-1 text-[10px] text-dim">bot</span>}
                <span className="text-dim">{relativeTime(comment.createdAt)}</span>
                {i === 0 && comment.resolved && <span className="text-green">resolved</span>}
                {i === 0 && comment.outdated && !comment.resolved && (
                  <span className="text-dim">outdated</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {i === 0 && comment.threadId && actions && (
                    <button
                      onClick={() => {
                        actions.onResolve(comment.threadId!, !comment.resolved);
                        if (!comment.resolved) setCollapsed(true);
                      }}
                      className="rounded border border-edge2 px-1.5 py-0.5 text-[10px] text-mut hover:border-edge3 hover:text-ink"
                    >
                      {comment.resolved ? "Unresolve" : "Resolve"}
                    </button>
                  )}
                  <button
                    onClick={() => window.open(comment.url)}
                    className="text-dim hover:text-ink"
                    title="Open on GitHub"
                  >
                    <Icon name="external" size={11} />
                  </button>
                </span>
              </div>
              <Markdown>{comment.body}</Markdown>
            </div>
          ))}
          {first.threadId && actions && (
            <div className="border-t border-edge px-3 py-2">
              {replying ? (
                <TextBox
                  placeholder="Reply…"
                  sendLabel="Reply"
                  autoFocus
                  onCancel={() => setReplying(false)}
                  onSend={async (body) => {
                    const ok = await actions.onReply(first.threadId!, body);
                    if (ok) setReplying(false);
                    return ok;
                  }}
                />
              ) : (
                <button
                  onClick={() => setReplying(true)}
                  className="w-full rounded border border-edge2 px-2 py-1 text-left font-sans text-[11px] text-dim hover:border-edge3 hover:text-mut"
                >
                  Reply…
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Groups a file's comments back into their threads, oldest first. */
export function threadsOf(comments: PrComment[]): PrComment[][] {
  const byThread = new Map<string, PrComment[]>();
  for (const comment of comments) {
    const key = comment.threadId ?? `c${comment.id}`;
    byThread.set(key, [...(byThread.get(key) ?? []), comment]);
  }
  return [...byThread.values()];
}

export type Draft = ReviewDraft;

export function DraftCard({ draft, onDelete }: { draft: Draft; onDelete: () => void }) {
  return (
    <div className="mx-2 my-1.5 rounded-lg border border-accent/40 bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="rounded bg-accent/15 px-1 text-accent">draft</span>
        {draft.startLine && draft.startLine < draft.line && (
          <span className="text-dim">
            L{draft.startLine}–{draft.line}
          </span>
        )}
        <span className="text-dim">sent with your review</span>
        <button onClick={onDelete} className="ml-auto text-dim hover:text-red">
          <Icon name="x" size={11} />
        </button>
      </div>
      <Markdown>{draft.body}</Markdown>
    </div>
  );
}

export interface ComposerTarget {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
}

export function Composer({
  target,
  onSave,
  onCancel,
}: {
  target: ComposerTarget;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const range = target.startLine && target.startLine < target.line;
  return (
    <div className="mx-2 my-1.5 rounded-lg border border-accent/40 bg-card px-3 py-2">
      <div className="pb-1.5 font-sans text-[11px] text-dim">
        {range ? `Comment on lines ${target.startLine}–${target.line}` : `Comment on line ${target.line}`}
        <span className="ml-2 text-dim/70">drag over line numbers to pick a range</span>
      </div>
      <TextBox
        placeholder="Leave a comment for the author…"
        sendLabel="Add to review"
        autoFocus
        onCancel={onCancel}
        onSend={(body) => onSave(body)}
      />
    </div>
  );
}
