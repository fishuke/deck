import { describe, expect, it } from "vitest";
import { attentionReasons, prsNeedingYou, readyToMerge, type InboxPr } from "../src/shared/prs.js";

const pr = (number: number, extra: Partial<InboxPr> = {}): InboxPr => ({
  repo: "acme/api", number, title: `PR ${number}`, url: "", author: "me", isDraft: false,
  updatedAt: "2026-09-10T10:00:00Z", headRefName: "feature", baseRefName: "main",
  reviewDecision: null, mergeable: "MERGEABLE", checks: "SUCCESS", ...extra,
});

describe("attentionReasons", () => {
  it("finds nothing wrong with a healthy PR", () => {
    expect(attentionReasons(pr(1))).toEqual([]);
  });

  it("reports every problem a PR has at once", () => {
    expect(attentionReasons(pr(1, { reviewDecision: "CHANGES_REQUESTED", checks: "FAILURE", mergeable: "CONFLICTING" })))
      .toEqual(["changes_requested", "ci_failed", "conflicts"]);
  });
});

describe("readyToMerge", () => {
  it("accepts an approved, green, cleanly merging PR", () => {
    expect(readyToMerge(pr(1, { reviewDecision: "APPROVED" }))).toBe(true);
  });

  it("accepts a green PR on a repo that requires no review", () => {
    expect(readyToMerge(pr(1, { reviewDecision: null }))).toBe(true);
    expect(readyToMerge(pr(1, { reviewDecision: null, checks: "NONE" }))).toBe(true);
  });

  it("refuses anything still blocked", () => {
    expect(readyToMerge(pr(1, { reviewDecision: "REVIEW_REQUIRED" }))).toBe(false);
    expect(readyToMerge(pr(1, { reviewDecision: "CHANGES_REQUESTED" }))).toBe(false);
    expect(readyToMerge(pr(1, { reviewDecision: "APPROVED", checks: "PENDING" }))).toBe(false);
    expect(readyToMerge(pr(1, { reviewDecision: "APPROVED", mergeable: "CONFLICTING" }))).toBe(false);
    expect(readyToMerge(pr(1, { reviewDecision: "APPROVED", isDraft: true }))).toBe(false);
  });
});

describe("prsNeedingYou", () => {
  it("drops the PRs that are merely waiting", () => {
    expect(prsNeedingYou([pr(1), pr(2, { checks: "PENDING" })])).toEqual([]);
  });

  it("puts the most broken first, then the longest untouched", () => {
    const ranked = prsNeedingYou([
      pr(1, { checks: "FAILURE", updatedAt: "2026-09-12T10:00:00Z" }),
      pr(2, { checks: "FAILURE", mergeable: "CONFLICTING", updatedAt: "2026-09-11T10:00:00Z" }),
      pr(3, { checks: "FAILURE", updatedAt: "2026-09-01T10:00:00Z" }),
    ]);
    expect(ranked.map((entry) => entry.pr.number)).toEqual([2, 3, 1]);
  });
});
