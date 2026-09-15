import { describe, expect, it } from "vitest";
import type { InboxPr } from "../src/shared/prs.js";
import { partOfDay, waitingCount, waitingParts, waitingSummary, yourPrs } from "../src/renderer/src/agents/greeting.js";

const pr = (number: number, extra: Partial<InboxPr> = {}): InboxPr => ({
  repo: "acme/api", number, title: `PR ${number}`, url: "", author: "me", isDraft: false,
  updatedAt: `2026-09-1${number}T10:00:00Z`, headRefName: "f", baseRefName: "main",
  reviewDecision: null, mergeable: "MERGEABLE", checks: "SUCCESS", ...extra,
});

describe("yourPrs", () => {
  it("puts what is broken above what is ready, and ignores the rest", () => {
    const rows = yourPrs([
      pr(1, { reviewDecision: "APPROVED" }),
      pr(2, { checks: "FAILURE" }),
      pr(3, { reviewDecision: "REVIEW_REQUIRED" }),
    ]);
    expect(rows.map((row) => [row.pr.number, row.ready])).toEqual([[2, false], [1, true]]);
  });
});

describe("waitingSummary", () => {
  it("says nothing when nothing is waiting", () => {
    expect(waitingSummary({ agents: 0, prs: 0, reviews: 0 })).toBe("");
    expect(waitingCount({ agents: 0, prs: 0, reviews: 0 })).toBe(0);
  });

  it("reads as a sentence, singular and plural", () => {
    expect(waitingSummary({ agents: 0, prs: 1, reviews: 0 })).toBe("1 of your pull requests");
    expect(waitingSummary({ agents: 0, prs: 2, reviews: 3 })).toBe("2 of your pull requests and 3 reviews");
    expect(waitingSummary({ agents: 1, prs: 2, reviews: 3 }))
      .toBe("2 of your pull requests, 1 agent and 3 reviews");
  });

  it("counts everything it names", () => {
    expect(waitingCount({ agents: 1, prs: 2, reviews: 3 })).toBe(6);
  });
});

describe("partOfDay", () => {
  it("greets by the hour", () => {
    expect(partOfDay(new Date("2026-09-14T08:00:00"))).toBe("morning");
    expect(partOfDay(new Date("2026-09-14T13:00:00"))).toBe("afternoon");
    expect(partOfDay(new Date("2026-09-14T20:00:00"))).toBe("evening");
  });
});

describe("waitingParts", () => {
  it("gives every part a question deck can answer", () => {
    const parts = waitingParts({ agents: 1, prs: 2, reviews: 3 });
    expect(parts.map((part) => part.text)).toEqual(["2 of your pull requests", "1 agent", "3 reviews"]);
    for (const part of parts) expect(part.prompt).toMatch(/\?$/);
  });

  it("asks about the right thing", () => {
    expect(waitingParts({ agents: 0, prs: 1, reviews: 0 })[0].prompt).toContain("pull requests need me");
    expect(waitingParts({ agents: 1, prs: 0, reviews: 0 })[0].prompt).toContain("agents are waiting on me");
    expect(waitingParts({ agents: 0, prs: 0, reviews: 1 })[0].prompt).toContain("waiting on my review");
  });

  it("names nothing that is empty", () => {
    expect(waitingParts({ agents: 0, prs: 0, reviews: 0 })).toEqual([]);
  });
});
