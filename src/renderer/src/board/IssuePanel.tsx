import { AgentSelect, useAgentChoice } from "../agents/AgentSelect.js";
import { useEffect, useMemo, useState } from "react";
import type { IssuePr } from "../../../main/github.js";
import type { RepoDir } from "../../../main/providers.js";
import type { BoardIssue } from "../../../main/board/types.js";
import type { AgentSession } from "../../../main/sessions.js";
import { StatusMark, statusLabels, statusTones } from "../chrome/SessionIcon.js";
import { useTabs } from "../store.js";

const stateColor: Record<string, string> = {
  OPEN: "text-green",
  MERGED: "text-accent",
  CLOSED: "text-red",
};

export interface IssuePanelProps {
  issue: BoardIssue;
  rejected: boolean;
  onClose: () => void;
  onOpenDiff: (pr: IssuePr) => void;
}

export function IssuePanel({ issue, rejected, onClose, onOpenDiff }: IssuePanelProps) {
  const { newTab, tabs, focusTab } = useTabs();
  const [agent, setAgent] = useAgentChoice();
  const [prs, setPrs] = useState<IssuePr[]>();
  const [repos, setRepos] = useState<RepoDir[]>([]);
  const [repoPath, setRepoPath] = useState<string>("");
  const [sessions, setSessions] = useState<AgentSession[]>([]);

  useEffect(() => {
    setPrs(undefined);
    void window.deck.gh.prsForIssue(issue.key).then(setPrs);
    return window.deck.gh.onPrsChanged((key, next) => {
      if (key === issue.key) setPrs(next);
    });
  }, [issue.key]);

  useEffect(() => {
    void window.deck.search.listRepos().then(setRepos);
    void window.deck.sessions.list().then(setSessions);
    return window.deck.sessions.onChanged(setSessions);
  }, []);

  const linked = useMemo(
    () => sessions.filter((s) => s.issue_key === issue.key),
    [sessions, issue.key],
  );
  const openTermIds = new Set(tabs.map((t) => t.termId));

  // A PR's repo is the best guess for where the agent should work.
  useEffect(() => {
    const prRepo = prs?.[0]?.repo.split("/")[1];
    const match = repos.find((r) => r.name === prRepo);
    if (match) setRepoPath((p) => p || match.path);
  }, [prs, repos]);

  const spinUp = () => {
    const prompt = rejected
      ? `${issue.key}: ${issue.summary} — the code was rejected in review. Look at the PR feedback and address it.`
      : `${issue.key}: ${issue.summary}`;
    void newTab({
      cwd: repoPath || undefined,
      agent,
      prompt,
      issueKey: issue.key,
    });
  };

  const continueSession = (s: AgentSession) => {
    if (s.term_id && openTermIds.has(s.term_id)) focusTab(s.term_id);
    else
      void newTab({ cwd: s.cwd, agent: s.agent, sessionId: s.session_id, issueKey: issue.key });
  };

  return (
    <div className="flex w-[400px] shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <span className="text-[11px] text-dim">{issue.key}</span>
        <span className="text-[11px] text-orange">◐ {issue.statusName.toLowerCase()}</span>
        <button onClick={onClose} className="ml-auto text-dim hover:text-ink">
          ×
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        <div className="text-sm leading-relaxed text-ink">{issue.summary}</div>
        <div className="flex gap-2 text-[10px]">
          <span className="rounded bg-card2 px-2 py-0.5 text-mut">
            {issue.assignee ?? "unassigned"}
          </span>
          <button
            onClick={() => window.open(issue.url)}
            className="rounded bg-card2 px-2 py-0.5 text-accent hover:underline"
          >
            open issue ↗
          </button>
        </div>

        <div className="pt-1 text-[10px] tracking-widest text-dim">AGENTS</div>
        {linked.length === 0 && (
          <div className="-mt-2 text-[11px] text-dim">no agent has touched this ticket</div>
        )}
        {linked.map((s) => {
          const g = statusTones[s.status];
          return (
            <button
              key={s.session_id}
              onClick={() => continueSession(s)}
              title={
                s.term_id && openTermIds.has(s.term_id) ? "Focus session" : "Continue session"
              }
              className="flex items-center gap-2.5 rounded-lg border border-edge2 bg-card px-3 py-2 text-left hover:border-edge3"
            >
              <span className={g.text}><StatusMark status={s.status} /></span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-soft">
                {s.title ?? s.session_id.slice(0, 8)}
              </span>
              <span className={`shrink-0 text-[10px] ${g.text}`}>
                {s.term_id && openTermIds.has(s.term_id) ? "focus →" : `${statusLabels[s.status].toLowerCase()} · continue →`}
              </span>
            </button>
          );
        })}
        <div
          className={`flex gap-2 ${rejected ? "rounded-md border border-red/40 bg-red/10 p-2" : ""}`}
        >
          <select
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-edge2 bg-card px-2 py-1.5 text-[11px] text-body outline-none"
          >
            <option value="">default cwd</option>
            {repos.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
          <AgentSelect value={agent} onChange={setAgent} />
          <button
            onClick={spinUp}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] ${
              rejected
                ? "border-red/40 text-red hover:bg-red/20"
                : "border-edge2 text-accent hover:border-accent"
            }`}
          >
            {rejected ? "✗ fix rejection" : `✳ spin up ${agent}`}
          </button>
        </div>

        <div className="pt-1 text-[10px] tracking-widest text-dim">PULL REQUESTS</div>
        {prs === undefined && <div className="-mt-2 text-[11px] text-dim">searching…</div>}
        {prs?.length === 0 && <div className="-mt-2 text-[11px] text-dim">none found</div>}
        {prs?.map((pr) => (
          <div
            key={`${pr.repo}#${pr.number}`}
            className="rounded-lg border border-edge2 bg-card p-3"
          >
            <div className="flex items-center gap-2">
              <span className={`text-[11px] ${stateColor[pr.state] ?? "text-dim"}`}>
                {pr.isDraft ? "draft" : pr.state.toLowerCase()}
              </span>
              <span className="truncate text-xs text-soft">
                #{pr.number} {pr.title}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-dim">{pr.repo.split("/")[1] ?? pr.repo}</div>
            <div className="mt-2 flex gap-3 text-[11px]">
              <button onClick={() => onOpenDiff(pr)} className="text-accent hover:underline">
                view diff
              </button>
              <button onClick={() => window.open(pr.url)} className="text-dim hover:text-ink">
                github ↗
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
