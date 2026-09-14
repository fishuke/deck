import { useEffect, useMemo, useState } from "react";
import type { BoardCache, BoardIssue } from "../../../main/board/types.js";
import type { InboxPr, PrInbox } from "../../../main/prInbox.js";
import type { ReviewSource } from "../../../shared/settings.js";
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

/** The PRs waiting on the user, oldest first so nothing sits unreviewed while
 *  new ones jump the queue. A PR stays until it is merged or closed:
 *  reviewing it is not always the end of the user's part. */
export function reviewQueue(prs: InboxPr[]): InboxPr[] {
  return prs.filter((pr) => !pr.isDraft).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** The inbox list the queue is built from: GitHub's review requests, with the
 *  PRs the user has already reviewed behind them, or the board's review
 *  column. */
function sourceList(inbox: PrInbox | undefined, source: ReviewSource): InboxPr[] {
  if (source === "board") return inbox?.reviewColumn ?? [];
  const reviewed = inbox?.reviewed ?? [];
  return [
    ...(inbox?.reviewRequested ?? []),
    ...reviewed.filter((pr) => pr.newSinceReview),
    ...reviewed.filter((pr) => !pr.newSinceReview),
  ];
}

/** Live review queue plus the board it was built from. */
export function useReviewQueue() {
  const inbox = usePrInbox();
  const [board, setBoard] = useState<BoardCache>();
  const settings = useSettings();
  const source = settings?.reviewSource ?? "github";

  useEffect(() => {
    void window.deck.board.get().then(setBoard);
    return window.deck.board.onChanged(setBoard);
  }, []);

  const waiting = useMemo(() => sourceList(inbox, source), [inbox, source]);
  const queue = useMemo(() => reviewQueue(waiting), [waiting]);
  const reviewed = useMemo(() => new Map(
    [...(inbox?.reviewed ?? []), ...(inbox?.reviewColumn ?? [])]
      .filter((pr) => pr.reviewedByViewer)
      .map((pr) => [prKey(pr), Boolean(pr.newSinceReview)]),
  ), [inbox]);
  // Every open PR the reviews page can show, queued or not.
  const lists = useMemo(() => ({
    waiting: source === "board" ? inbox?.reviewColumn ?? [] : inbox?.reviewRequested ?? [],
    reviewed: inbox?.reviewed ?? [],
    mine: inbox?.mine ?? [],
  }), [inbox, source]);
  // Queued PRs awaiting a first review, or with new work since the user's.
  const actionable = useMemo(() => queue.filter((pr) => !pr.reviewedByViewer || pr.newSinceReview).length, [queue]);
  // The board source has nothing to go on until a column is picked.
  const needsColumn = source === "board" && (settings?.board.reviewColumns.length ?? 0) === 0;
  return { queue, board, loaded: inbox !== undefined, reviewed, actionable, lists, source, needsColumn };
}
