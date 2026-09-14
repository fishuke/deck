import { describe, expect, it } from "vitest";
import type { BoardCache } from "../src/main/board/types.js";
import type { InboxPr } from "../src/main/prInbox.js";
import { issueFor, reviewQueue } from "../src/renderer/src/lib/reviews.js";

const pr = (number: number, title: string, extra: Partial<InboxPr> = {}): InboxPr => ({
  repo: "acme/api", number, title, url: "", author: "teammate", isDraft: false, updatedAt: `2026-09-0${number}T10:00:00Z`,
  headRefName: "f", baseRefName: "main", reviewDecision: null, mergeable: "MERGEABLE", checks: "SUCCESS", ...extra,
});

const board: BoardCache = {
  provider: "jira", boardName: "INI", at: 0,
  columns: [{ name: "In Progress", statusIds: ["3"] }, { name: "Review", statusIds: ["4", "5"] }],
  issues: [
    { id: "1", key: "INI-1", summary: "", statusId: "4", statusName: "Review", assignee: null, assigneeId: null, updated: "", url: "" },
    { id: "2", key: "INI-2", summary: "", statusId: "3", statusName: "In Progress", assignee: null, assigneeId: null, updated: "", url: "" },
  ],
};

const requested = [pr(3, "INI-1 add thing"), pr(2, "INI-2 other thing"), pr(1, "no key", { headRefName: "chore/x" }), pr(4, "INI-1 draft", { isDraft: true })];

describe("reviewQueue", () => {
  it("keeps every non-draft request when no review columns are configured, oldest first", () => {
    expect(reviewQueue(requested, board, []).map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("only keeps PRs whose card sits in a review column", () => {
    expect(reviewQueue(requested, board, ["Review"]).map((p) => p.number)).toEqual([3]);
  });

  it("drops everything when columns are configured but the board has not synced", () => {
    expect(reviewQueue(requested, undefined, ["Review"])).toEqual([]);
  });

  it("keeps a PR the user has already reviewed, since it is not merged yet", () => {
    const approved = pr(2, "INI-2 other thing", { reviewDecision: "APPROVED" });
    expect(reviewQueue([approved], board, []).map((p) => p.number)).toEqual([2]);
  });
});

describe("issueFor", () => {
  it("finds the card by key in the title or branch", () => {
    expect(issueFor(pr(9, "fix it", { headRefName: "INI-2-fix" }), board)?.key).toBe("INI-2");
    expect(issueFor(pr(9, "fix it"), board)).toBeUndefined();
  });

  it("matches GitHub cards by repo and issue number", () => {
    const github: BoardCache = {
      ...board, provider: "github",
      issues: [{ id: "i1", key: "api#12", summary: "", statusId: "4", statusName: "Review", assignee: null, assigneeId: null, updated: "", url: "" }],
    };
    expect(issueFor(pr(9, "Fix login (#12)"), github)?.key).toBe("api#12");
    expect(issueFor(pr(9, "fix it", { headRefName: "12-fix-login" }), github)?.key).toBe("api#12");
    expect(issueFor(pr(9, "Bump to v12"), github)).toBeUndefined();
    expect(issueFor(pr(9, "Fix #12", { repo: "acme/web" }), github)).toBeUndefined();
  });
});
