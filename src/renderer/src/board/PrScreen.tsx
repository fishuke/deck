import { useAgentChoice } from "../agents/AgentSelect.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseDiff, type FileData, type ViewType } from "react-diff-view";
import type { IssuePr, MergeMethod, PrComment, PrDetail, ReviewEvent } from "../../../main/github.js";
import type { BoardIssue } from "../../../main/board/types.js";
import type { RepoDir } from "../../../main/providers.js";
import type { ComposerTarget, Draft, ThreadActions } from "./PrComments.js";
import { PrDiffTab, type AskAgentRequest } from "./PrDiffTab.js";
import { PrStackStrip } from "./PrStackStrip.js";
import { PrOverview } from "./PrOverview.js";
import { Icon } from "./icons.js";
import { PrAgentPanel } from "./PrAgentPanel.js";
import { useReviewChat } from "./useReviewChat.js";
import { usePrData } from "../lib/prData.js";
import { checksSummary, shellQuote, Stat, toneColor } from "./prUi.js";

// GitHub enables its merge button for exactly these merge-box states.
const MERGEABLE_STATES = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);

const mergeBlocker = (detail: PrDetail): string | undefined => {
  if (detail.isDraft) return "Draft PRs can't be merged";
  if (detail.mergeable === "CONFLICTING") return "Resolve merge conflicts first";
  switch (detail.mergeStateStatus) {
    case "BEHIND":
      return `Branch is behind ${detail.baseRefName}`;
    case "BLOCKED":
      return detail.reviewDecision === "APPROVED"
        ? "Blocked by branch protection (checks or rules)"
        : "Needs an approving review";
    case "DIRTY":
      return "Resolve merge conflicts first";
    case "UNKNOWN":
      return "GitHub is still computing mergeability";
    default:
      return MERGEABLE_STATES.has(detail.mergeStateStatus) ? undefined : "Not mergeable right now";
  }
};

const VIEW_TYPE_KEY = "deck.pr.viewType";
const ASSISTANT_KEY = "deck.pr.assistant";

const mergeLabel: Record<MergeMethod, string> = {
  merge: "Merge",
  squash: "Squash & merge",
  rebase: "Rebase & merge",
};

const isTyping = (e: KeyboardEvent) =>
  ["TEXTAREA", "INPUT", "SELECT"].includes((e.target as HTMLElement)?.tagName ?? "");

type Tab = "overview" | "diff";

export interface PrScreenProps {
  pr: IssuePr;
  issue?: BoardIssue;
  onClose: () => void;
  /** Rendered inside a page (the review queue) instead of as a full-screen overlay. */
  embedded?: boolean;
  /** Kept mounted but out of sight, so the tab, file and loaded data survive a view switch. */
  hidden?: boolean;
  /** A review went out; the queue uses it to move on. */
  onReviewed?: (event: ReviewEvent) => void;
}

export function PrScreen({ pr, issue, onClose, embedded = false, hidden = false, onReviewed }: PrScreenProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const { diffText, detail, comments, timeline, refresh, setComments } = usePrData(pr.repo, pr.number);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string>();
  const [viewType, setViewType] = useState<ViewType>(
    () => (localStorage.getItem(VIEW_TYPE_KEY) as ViewType | null) ?? "unified",
  );
  const [busy, setBusy] = useState<"review" | "merge">();
  const [actionError, setActionError] = useState<string>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>();
  const [repos, setRepos] = useState<RepoDir[]>([]);
  const [agent, setAgent] = useAgentChoice();
  const [agentOpen, setAgentOpen] = useState(() => localStorage.getItem(ASSISTANT_KEY) === "open");
  const rejectRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void window.deck.search.listRepos().then(setRepos);
  }, []);

  useEffect(() => {
    if (detail) setViewed(new Set(detail.files.filter((f) => f.viewed).map((f) => f.path)));
  }, [detail]);

  useEffect(() => localStorage.setItem(VIEW_TYPE_KEY, viewType), [viewType]);
  useEffect(() => localStorage.setItem(ASSISTANT_KEY, agentOpen ? "open" : "closed"), [agentOpen]);

  const files = useMemo<FileData[]>(() => {
    if (!diffText || diffText.startsWith("diff unavailable")) return [];
    try {
      return parseDiff(diffText);
    } catch {
      return [];
    }
  }, [diffText]);
  const paths = useMemo(() => files.map((f) => f.newPath || f.oldPath), [files]);
  const checkoutCwd = repos.find((r) => r.name === pr.repo.split("/")[1])?.path;

  // Drafts belong to the PR, not to this screen: the main process keeps them
  // (the review assistant adds its own there too), so they survive leaving
  // the PR and restarting deck.
  useEffect(() => {
    void window.deck.review.drafts(pr.repo, pr.number).then(setDrafts);
    return window.deck.review.onDrafts((repo, number, next) => {
      if (repo === pr.repo && number === pr.number) setDrafts(next);
    });
  }, [pr.repo, pr.number]);

  const chat = useReviewChat({
    repo: pr.repo, number: pr.number, title: pr.title, author: detail?.author ?? pr.author, viewer: detail?.viewer,
    headRefName: detail?.headRefName, baseRefName: detail?.baseRefName, cwd: checkoutCwd,
  }, agent);

  const methods = detail?.mergeMethods ?? ["merge"];
  const chosenMethod = mergeMethod && methods.includes(mergeMethod) ? mergeMethod : methods[0];
  const merged = detail?.state === "MERGED";
  const closed = detail?.state === "CLOSED";
  const approved = detail?.reviewDecision === "APPROVED";
  const canComment = !merged && !closed;
  const blocker = detail ? mergeBlocker(detail) : "Loading…";
  const autoMerge = detail?.autoMerge ?? null;

  const toggleViewed = (path: string) => {
    if (!detail) return;
    const next = !viewed.has(path);
    setViewed((v) => {
      const set = new Set(v);
      if (next) set.add(path);
      else set.delete(path);
      return set;
    });
    void window.deck.gh.setFileViewed(detail.id, path, next).then((result) => {
      if (result.ok) return;
      setActionError(result.error);
      setViewed((v) => {
        const set = new Set(v);
        if (next) set.delete(path);
        else set.add(path);
        return set;
      });
    });
  };

  const submitReview = async (event: ReviewEvent, body = "") => {
    setBusy("review");
    setActionError(undefined);
    const result = await window.deck.gh.review(
      pr.repo,
      pr.number,
      event,
      body,
      drafts.map(({ id: _id, ...comment }) => comment),
    );
    setBusy(undefined);
    if (!result.ok) return setActionError(result.error);
    void window.deck.review.clearDrafts(pr.repo, pr.number);
    setComposer(null);
    setRejectOpen(false);
    refresh();
    onReviewed?.(event);
  };

  const merge = async () => {
    setBusy("merge");
    setMergeOpen(false);
    setActionError(undefined);
    const result = await window.deck.gh.merge(pr.repo, pr.number, chosenMethod, issue?.key);
    setBusy(undefined);
    // The merge may have gone through even when the follow-up move failed.
    refresh();
    if (!result.ok) setActionError(result.error);
  };

  const enableAutoMerge = async () => {
    setBusy("merge");
    setMergeOpen(false);
    setActionError(undefined);
    const result = await window.deck.gh.autoMerge(pr.repo, pr.number, chosenMethod);
    setBusy(undefined);
    if (!result.ok) return setActionError(result.error);
    refresh();
  };

  const report = (result: { ok: true } | { ok: false; error: string }) => {
    if (!result.ok) setActionError(result.error);
    else refresh();
    return result.ok;
  };

  const threadActions: ThreadActions = {
    onReply: (threadId, body) => window.deck.gh.replyToThread(threadId, body).then(report),
    onResolve: (threadId, resolved) => {
      // Optimistic: flip the thread locally, GitHub confirms on refresh.
      setComments((cs) => cs.map((c) => (c.threadId === threadId ? { ...c, resolved } : c)));
      void window.deck.gh.setThreadResolved(threadId, resolved).then(report);
    },
  };

  const addComment = (body: string) => window.deck.gh.addComment(pr.repo, pr.number, body).then(report);

  // Selected lines go to the review assistant, opening it if needed.
  const askAgent = ({ path, side, start, end, snippet, question }: AskAgentRequest) => {
    const where = start === end ? `line ${start}` : `lines ${start}–${end}`;
    const which = side === "LEFT" ? "the old version" : "the new version";
    const prompt = [
      `Reviewing PR #${pr.number} in ${pr.repo} — "${pr.title}"` +
        (detail ? ` (${detail.headRefName} → ${detail.baseRefName}).` : "."),
      `File ${path}, ${where} of ${which}:`,
      "```",
      snippet,
      "```",
      question,
    ].join("\n");
    setAgentOpen(true);
    void chat.ask(prompt);
  };

  const openComposer = (target: ComposerTarget, extend: boolean) => {
    setComposer((prev) => {
      if (extend && prev && prev.path === target.path && prev.side === target.side) {
        const lines = [prev.startLine ?? prev.line, prev.line, target.line];
        return { ...prev, startLine: Math.min(...lines), line: Math.max(...lines) };
      }
      return target;
    });
  };

  const openFile = (path: string) => {
    setTab("diff");
    setActivePath(path);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hidden || isTyping(e)) return;
      if (e.key === "Escape") {
        if (composer) setComposer(null);
        else if (rejectOpen) setRejectOpen(false);
        else if (mergeOpen) setMergeOpen(false);
        else if (menuOpen) setMenuOpen(false);
        else if (!embedded) onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") setTab("overview");
      else if (e.key === "2") setTab("diff");
      else if (e.key === "a") setAgentOpen((o) => !o);
      else if (e.key === "j" || e.key === "k") {
        if (paths.length === 0) return;
        const current = activePath ? paths.indexOf(activePath) : -1;
        const next =
          e.key === "j" ? Math.min(current + 1, paths.length - 1) : Math.max(current - 1, 0);
        openFile(paths[next]);
      } else if (e.key === "v" && activePath && tab === "diff") toggleViewed(activePath);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const generalComments = useMemo(() => comments.filter((c) => !c.path), [comments]);
  const commentsByPath = useMemo(() => {
    const map = new Map<string, PrComment[]>();
    for (const comment of comments) {
      if (!comment.path) continue;
      map.set(comment.path, [...(map.get(comment.path) ?? []), comment]);
    }
    return map;
  }, [comments]);

  const checks = detail ? checksSummary(detail.checks) : undefined;
  const openThreads = comments.filter((c) => c.path && !c.resolved && !c.outdated).length;

  return (
    <div className={hidden ? "hidden" : embedded ? "flex min-h-0 min-w-0 flex-1 flex-col bg-bg" : "fixed inset-0 z-40 flex flex-col bg-bg pt-[38px]"}>
      <div className="flex items-center gap-2 border-b border-edge px-5 py-2 font-sans text-[12px]">
        {issue && (
          <>
            <span className="text-mut">{issue.key}</span>
            <span className="text-dim">›</span>
          </>
        )}
        <Icon name="branch" className={merged ? "text-accent" : closed ? "text-red" : "text-green"} />
        <span className="truncate text-ink">
          <span className="text-mut">#{pr.number}</span> {pr.title}
        </span>
        {detail && <Stat additions={detail.additions} deletions={detail.deletions} />}
        {checks && (
          <Icon
            name={checks.tone === "pass" ? "checkSquare" : checks.tone === "fail" ? "xSquare" : "clock"}
            className={toneColor[checks.tone]}
            title={`Checks: ${checks.label}`}
          />
        )}
        {detail?.reviewDecision && (
          <span
            className={`rounded px-1.5 text-[10px] ${
              approved ? "bg-green/15 text-green" : "bg-orange/15 text-orange"
            }`}
          >
            {detail.reviewDecision.toLowerCase().replace("_", " ")}
          </span>
        )}
        {detail?.mergeable === "CONFLICTING" && (
          <span className="rounded bg-red/15 px-1.5 text-[10px] text-red" title={`Conflicts with ${detail.baseRefName}`}>
            merge conflicts
          </span>
        )}
        <span className="relative ml-auto flex items-center gap-3 text-[11px] text-dim">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            title="More"
            className={`rounded px-1 hover:text-ink ${menuOpen ? "bg-card2 text-ink" : ""}`}
          >
            <Icon name="dots" />
          </button>
          {!embedded && (
            <button onClick={onClose} className="flex items-center gap-1 hover:text-ink">
              esc <Icon name="x" size={11} />
            </button>
          )}
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-[200px] rounded-md border border-edge2 bg-panel p-1 font-sans text-[12px] text-body shadow-lg"
              onClick={() => setMenuOpen(false)}
            >
              <button
                onClick={() => void navigator.clipboard.writeText(pr.url)}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-card2"
              >
                <Icon name="link" className="text-dim" /> Copy link
              </button>
              <button
                onClick={() => window.open(pr.url)}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-card2"
              >
                <Icon name="external" className="text-dim" /> Open on GitHub
              </button>
              {issue && (
                <button
                  onClick={() => window.open(issue.url)}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-card2"
                >
                  <Icon name="issue" className="text-dim" /> Open {issue.key}
                </button>
              )}
            </div>
          )}
        </span>
      </div>

      <div className="relative flex items-center gap-1.5 border-b border-edge px-5 py-2 font-sans text-[12px]">
        {(["overview", "diff"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 ${
              tab === t ? "bg-card2 text-ink" : "text-mut hover:text-ink"
            }`}
          >
            {t === "overview" ? "Overview" : "Diff"}
            {t === "diff" && openThreads > 0 && (
              <span className="ml-1.5 text-[10px] text-orange">{openThreads}</span>
            )}
          </button>
        ))}
        <button
          onClick={() => setAgentOpen((o) => !o)}
          className={`ml-1 flex items-center gap-1.5 rounded-full px-3 py-1 ${
            agentOpen ? "bg-accent/15 text-accent" : "text-mut hover:text-ink"
          }`}
          title="Review assistant for this PR (a)"
        >
          <Icon name="sparkle" size={11} /> Assistant
        </button>
        <PrStackStrip repo={pr.repo} number={pr.number} title={pr.title} headRefName={detail?.headRefName} baseRefName={detail?.baseRefName} />
        {actionError && <span className="ml-3 truncate text-[11px] text-red">{actionError}</span>}

        <span className="ml-auto flex items-center gap-2">
          {merged ? (
            <span className="rounded-md bg-accent/15 px-3 py-1 text-accent">Merged</span>
          ) : closed ? (
            <span className="rounded-md bg-red/15 px-3 py-1 text-red">Closed</span>
          ) : (
            <>
              {drafts.length > 0 && (
                <button
                  onClick={() => void submitReview("COMMENT")}
                  disabled={busy !== undefined}
                  className="rounded-md border border-edge2 px-2.5 py-1 text-body hover:border-edge3 disabled:opacity-40"
                >
                  Send {drafts.length} comment{drafts.length > 1 ? "s" : ""}
                </button>
              )}
              <button
                onClick={() => setRejectOpen((o) => !o)}
                disabled={busy !== undefined}
                className="rounded-md border border-edge2 px-2.5 py-1 text-red hover:border-red disabled:opacity-40"
              >
                <Icon name="x" size={11} /> Request changes
              </button>
              <button
                onClick={() => void submitReview("APPROVE")}
                disabled={busy !== undefined || approved}
                className="rounded-md border border-edge2 px-2.5 py-1 text-green hover:border-green disabled:opacity-40"
              >
                {busy === "review" ? (
                  "Sending…"
                ) : (
                  <>
                    <Icon name="check" size={11} /> {approved ? "Approved" : "Approve"}
                    {!approved && drafts.length > 0 && ` +${drafts.length}`}
                  </>
                )}
              </button>
              {autoMerge && (
                <span
                  className="rounded-md bg-accent/15 px-2.5 py-1 text-accent"
                  title={`Auto-merge enabled by ${autoMerge.by}`}
                >
                  <Icon name="play" size={10} /> Auto-merge on
                </span>
              )}
              <span
                className={`flex overflow-hidden rounded-md text-bg ${
                  blocker ? "bg-accent/40" : "bg-accent"
                }`}
                title={blocker}
              >
                <button
                  onClick={() => void merge()}
                  disabled={busy !== undefined || blocker !== undefined}
                  className="px-3 py-1 font-semibold hover:bg-accent/90 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {busy === "merge" ? (
                    "Merging…"
                  ) : (
                    <>
                      <Icon name="branch" size={12} /> {mergeLabel[chosenMethod]}
                    </>
                  )}
                </button>
                <button
                  onClick={() => setMergeOpen((o) => !o)}
                  disabled={busy !== undefined}
                  className="border-l border-bg/20 px-2 py-1 hover:bg-accent/90"
                  title="Merge options"
                >
                  <Icon name="chevronDown" size={11} />
                </button>
              </span>
            </>
          )}
        </span>

        {mergeOpen && (
          <div className="absolute right-5 top-full z-50 mt-1 w-[260px] rounded-md border border-edge2 bg-panel p-1 shadow-lg">
            {blocker && <div className="px-2.5 py-1.5 text-[11px] text-orange">{blocker}</div>}
            {methods.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMergeMethod(m);
                  setMergeOpen(false);
                }}
                className={`block w-full rounded px-2.5 py-1.5 text-left hover:bg-card2 ${
                  m === chosenMethod ? "text-ink" : "text-mut"
                }`}
              >
                <Icon name={m === chosenMethod ? "dot" : "circle"} size={11} className="mr-1.5" />
                {mergeLabel[m]}
              </button>
            ))}
            {!autoMerge && (
              <button
                onClick={() => void enableAutoMerge()}
                className="mt-1 block w-full rounded border-t border-edge px-2.5 py-1.5 text-left text-accent hover:bg-card2"
                title="GitHub merges on its own once reviews and checks pass"
              >
                <Icon name="play" size={10} className="mr-1" />
                Enable auto-merge ({mergeLabel[chosenMethod].toLowerCase()})
              </button>
            )}
          </div>
        )}
        {rejectOpen && (
          <div className="absolute right-5 top-full z-50 mt-1 w-[380px] rounded-md border border-edge2 bg-panel p-3 shadow-lg">
            <div className="pb-1.5 text-[10px] text-dim">Say what needs to change.</div>
            <textarea
              ref={rejectRef}
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") setRejectOpen(false);
              }}
              className="w-full resize-y rounded border border-edge2 bg-bg px-2 py-1.5 font-sans text-[11px] text-body outline-none focus:border-red"
            />
            <button
              onClick={() => {
                const body = rejectRef.current?.value.trim();
                if (body) void submitReview("REQUEST_CHANGES", body);
              }}
              disabled={busy !== undefined}
              className="mt-1.5 rounded-md border border-red/40 px-2.5 py-1 text-[11px] text-red hover:bg-red/10 disabled:opacity-40"
            >
              Request changes{drafts.length > 0 ? ` +${drafts.length} drafts` : ""}
            </button>
          </div>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {tab === "overview" ? (
          <PrOverview
            pr={pr}
            detail={detail}
            issue={issue}
            generalComments={generalComments}
            timeline={timeline}
            commentsByPath={commentsByPath}
            viewed={viewed}
            onToggleViewed={toggleViewed}
            onOpenFile={openFile}
            threadActions={threadActions}
            onComment={addComment}
          />
        ) : (
          <PrDiffTab
            repo={pr.repo}
            detail={detail}
            files={files}
            diffText={diffText}
            viewType={viewType}
            onViewType={setViewType}
            viewed={viewed}
            onToggleViewed={toggleViewed}
            activePath={activePath}
            onActivate={setActivePath}
            canComment={canComment}
            commentsByPath={commentsByPath}
            drafts={drafts}
            composer={composer}
            onOpenComposer={openComposer}
            onCancelComposer={() => setComposer(null)}
            onSaveDraft={(body) => {
              if (!composer) return;
              void window.deck.review.addDraft(pr.repo, pr.number, { ...composer, body });
              setComposer(null);
            }}
            onDeleteDraft={(id) => void window.deck.review.removeDraft(pr.repo, pr.number, id)}
            threadActions={threadActions}
            onAskAgent={askAgent}
          />
        )}
        {agentOpen && (
          <PrAgentPanel
            pr={pr}
            detail={detail}
            cwd={checkoutCwd}
            issueKey={issue?.key}
            agent={agent}
            onAgent={(next) => { setAgent(next); chat.reset(); }}
            chat={chat}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
