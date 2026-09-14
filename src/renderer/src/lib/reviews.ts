import { useEffect, useMemo, useState } from "react";
import type { BoardCache, BoardIssue } from "../../../main/board/types.js";
import type { InboxPr } from "../../../main/prInbox.js";
import { prKey } from "../../../shared/prs.js";
import { usePrInbox } from "./useInbox.js";
import { useSettings } from "./useSettings.js";

// The review queue behind both the sidebar badge and the reviews page, so the
// two never disagree about how many PRs are waiting.

const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** The board card a PR belongs to. Jira and Linear keys (APP-12) are found
 *  in the title or branch; a GitHub key (repo#12) needs the same repo and
 *  the number as "#12" or as the "12-" prefix GitHub gives issue branches. */
export function issueFor(pr: InboxPr, board: BoardCache | undefined): BoardIssue | undefined {
  if (!board) return undefined;
  const text = `${pr.title} ${pr.headRefName}`;
  const key = ISSUE_KEY.exec(text)?.[0];
  if (key) return board.issues.find((i) => i.key === key);
  const repoName = pr.repo.split("/")[1];
  return board.issues.find((i) => {
    const github = /^(.+)#(\d+)$/.exec(i.key);
    return github && github[1] === repoName && new RegExp(`#${github[2]}\\b|(^|[\\s/])${github[2]}-`).test(text);
  });
}

/** Non-draft review requests, oldest first so nothing sits unreviewed while
 *  new ones jump the queue. With review columns configured, only PRs whose
 *  card sits in one of those columns make it in. A PR stays until it is
 *  merged or closed: reviewing it is not always the end of the user's part. */
export function reviewQueue(requested: InboxPr[], board: BoardCache | undefined, reviewColumns: string[]): InboxPr[] {
  const statusIds = new Set(board?.columns.filter((c) => reviewColumns.includes(c.name)).flatMap((c) => c.statusIds));
  const inReview = (pr: InboxPr) => {
    if (reviewColumns.length === 0) return true;
    const issue = issueFor(pr, board);
    return Boolean(issue && statusIds.has(issue.statusId));
  };
  return requested
    .filter((pr) => !pr.isDraft && inReview(pr))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** Live review queue plus the board it was built from. */
export function useReviewQueue() {
  const inbox = usePrInbox();
  const [board, setBoard] = useState<BoardCache>();
  const boardSettings = useSettings()?.board;

  useEffect(() => {
    void window.deck.board.get().then(setBoard);
    return window.deck.board.onChanged(setBoard);
  }, []);

  const waiting = useMemo(() => {
    const reviewed = inbox?.reviewed ?? [];
    return [
      ...(inbox?.reviewRequested ?? []),
      ...reviewed.filter((pr) => pr.newSinceReview),
      ...reviewed.filter((pr) => !pr.newSinceReview),
    ];
  }, [inbox]);
  const queue = useMemo(() => reviewQueue(waiting, board, boardSettings?.reviewColumns ?? []), [waiting, board, boardSettings]);
  const reviewed = useMemo(() => new Map((inbox?.reviewed ?? []).map((pr) => [prKey(pr), Boolean(pr.newSinceReview)])), [inbox]);
  // Every open PR the reviews page can show, queued or not.
  const lists = useMemo(() => ({
    waiting: inbox?.reviewRequested ?? [],
    reviewed: inbox?.reviewed ?? [],
    mine: inbox?.mine ?? [],
  }), [inbox]);
  // Queued PRs awaiting a first review, or with new work since the user's.
  const actionable = useMemo(() => queue.filter((pr) => reviewed.get(prKey(pr)) !== false).length, [queue, reviewed]);
  return { queue, board, loaded: inbox !== undefined, reviewed, actionable, lists };
}
