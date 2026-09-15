/** How deck identifies one pull request: "owner/name#number". */
export const prKey = (pr: { repo: string; number: number }): string => `${pr.repo}#${pr.number}`;

export interface InboxPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or null when no review rules apply. */
  reviewDecision: string | null;
  /** MERGEABLE, CONFLICTING or UNKNOWN. */
  mergeable: string;
  /** SUCCESS, FAILURE, ERROR, PENDING, EXPECTED or NONE. */
  checks: string;
  /** The head commit is newer than the user's last review on this PR. */
  newSinceReview?: boolean;
  /** The user has submitted a review on this PR. */
  reviewedByViewer?: boolean;
}

export interface PrInbox {
  viewer: string;
  mine: InboxPr[];
  reviewRequested: InboxPr[];
  /** Open PRs the user has already reviewed, excluding their own and any
   *  still in reviewRequested. */
  reviewed: InboxPr[];
  /** Open PRs of the cards in the board's review columns. Filled only while
   *  the reviews queue is sourced from the board. */
  reviewColumn: InboxPr[];
  at: number;
}

export type Attention = "changes_requested" | "ci_failed" | "conflicts";

/** Why one of the user's own PRs needs them; empty when it is just waiting. */
export function attentionReasons(pr: InboxPr): Attention[] {
  const reasons: Attention[] = [];
  if (pr.reviewDecision === "CHANGES_REQUESTED") reasons.push("changes_requested");
  if (pr.checks === "FAILURE" || pr.checks === "ERROR") reasons.push("ci_failed");
  if (pr.mergeable === "CONFLICTING") reasons.push("conflicts");
  return reasons;
}

/** Nothing is blocking this one: no review still required, checks are not
 *  failing or pending, and it merges cleanly. A null reviewDecision means the
 *  repo asks for no review, so green is enough. */
export function readyToMerge(pr: InboxPr): boolean {
  return !pr.isDraft
    && pr.mergeable === "MERGEABLE"
    && (pr.checks === "SUCCESS" || pr.checks === "NONE")
    && (pr.reviewDecision === "APPROVED" || pr.reviewDecision === null);
}

/** The user's own PRs that need them, most-neglected first: the ones with the
 *  most wrong, and among those the ones untouched longest. */
export function prsNeedingYou(mine: InboxPr[]): { pr: InboxPr; reasons: Attention[] }[] {
  return mine
    .map((pr) => ({ pr, reasons: attentionReasons(pr) }))
    .filter((entry) => entry.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || a.pr.updatedAt.localeCompare(b.pr.updatedAt));
}
