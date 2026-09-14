import { describe, expect, it, vi } from "vitest";
import type { BoardIssue } from "../src/main/board/types.js";

// The reviews queue sourced from the board: the cards in the review column
// decide what is in it, GitHub only fills in each PR's state.

const state = vi.hoisted(() => ({ queries: [] as string[], stored: undefined as unknown }));
vi.mock("../src/main/db.js", () => ({ kvGet: () => state.stored, kvSet: (_k: string, v: unknown) => (state.stored = v) }));
vi.mock("../src/main/settings.js", async () => {
  const { defaultSettings } = await import("../src/shared/settings.js");
  return {
    getSettings: () => ({
      ...defaultSettings,
      github: { owner: "acme" },
      reviewSource: "board",
      board: { ...defaultSettings.board, reviewColumns: ["Review"] },
    }),
  };
});

const issue = (key: string, statusId: string): BoardIssue =>
  ({ id: key, key, summary: "", statusId, statusName: "", assignee: null, assigneeId: null, updated: "", url: "" });

vi.mock("../src/main/board/board.js", () => ({
  getBoardCache: () => ({
    provider: "jira", boardName: "INI", at: 0,
    columns: [{ name: "Review", statusIds: ["4"] }, { name: "In Progress", statusIds: ["3"] }],
    issues: [issue("INI-1", "4"), issue("INI-2", "4"), issue("INI-3", "4"), issue("INI-4", "3")],
  }),
}));

const linked: Record<string, { repo: string; number: number; state: string }[]> = {
  "INI-1": [{ repo: "acme/api", number: 11, state: "OPEN" }],
  // The same PR from two cards, plus one the tracker still thinks is open.
  "INI-2": [{ repo: "acme/api", number: 11, state: "OPEN" }, { repo: "acme/api", number: 12, state: "OPEN" }],
  "INI-3": [{ repo: "acme/api", number: 13, state: "MERGED" }],
  "INI-4": [{ repo: "acme/api", number: 14, state: "OPEN" }],
};

vi.mock("../src/main/issuePrs.js", () => ({ prsForIssue: (key: string) => Promise.resolve(linked[key] ?? []) }));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const node = (number: number, extra: Record<string, unknown> = {}) => ({
    number, title: `PR ${number}`, url: "", isDraft: false, updatedAt: `2026-09-0${number % 9}T10:00:00Z`,
    headRefName: "f", baseRefName: "main", reviewDecision: null, mergeable: "MERGEABLE", state: "OPEN",
    author: { login: "teammate" }, repository: { nameWithOwner: "acme/api" },
    commits: { nodes: [{ commit: { committedDate: "2026-09-05T10:00:00Z", statusCheckRollup: { state: "SUCCESS" } } }] }, ...extra,
  });
  return {
    execFile: Object.assign(() => {}, {
      [promisify.custom]: async (_bin: string, args: string[]) => {
        const query = args[args.indexOf("-f") + 1];
        state.queries.push(query);
        if (!query.includes("repository(")) return { stdout: JSON.stringify({ data: { viewer: { login: "me" }, search: { nodes: [] } } }) };
        return {
          stdout: JSON.stringify({ data: {
            pr0: { pullRequest: node(11, { reviews: { nodes: [{ state: "APPROVED", submittedAt: "2026-09-06T10:00:00Z", author: { login: "me" } }] } }) },
            // Merged since the board's PR cache was filled.
            pr1: { pullRequest: node(12, { state: "MERGED" }) },
            // The user's own PR is not theirs to review.
            pr2: { pullRequest: node(14, { author: { login: "me" } }) },
          } }),
        };
      },
    }),
  };
});

const { refreshPrInbox } = await import("../src/main/prInbox.js");

describe("review column PRs", () => {
  it("looks up the open PRs of the cards in the review column, once each", async () => {
    const inbox = await refreshPrInbox();
    const lookup = state.queries.find((q) => q.includes("repository("))!;
    // INI-3's PR is already merged in the cache and INI-4 sits in another
    // column; PR 11 is on two cards but asked for once.
    expect(lookup.match(/pullRequest\(number: (\d+)\)/g)).toEqual(["pullRequest(number: 11)", "pullRequest(number: 12)"]);
    expect(inbox.reviewColumn.map((pr) => pr.number)).toEqual([11]);
    expect(inbox.reviewColumn[0]).toMatchObject({ repo: "acme/api", reviewedByViewer: true, newSinceReview: false });
  });
});
