import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[], stored: undefined as unknown, repos: [] as string[] }));
vi.mock("../src/main/db.js", () => ({ kvGet: () => state.stored, kvSet: (_k: string, v: unknown) => (state.stored = v) }));
vi.mock("../src/main/settings.js", async () => {
  const { defaultSettings } = await import("../src/shared/settings.js");
  return { getSettings: () => ({ ...defaultSettings, github: { ...defaultSettings.github, owner: "acme", repos: state.repos } }) };
});
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const node = (number: number, extra: Record<string, unknown>) => ({
    number, title: `PR ${number}`, url: `https://github.com/acme/api/pull/${number}`, isDraft: false, updatedAt: `2026-09-0${number}T10:00:00Z`,
    headRefName: "f", baseRefName: "main", reviewDecision: null, mergeable: "MERGEABLE", author: { login: "me" }, repository: { nameWithOwner: "acme/api" },
    commits: { nodes: [{ commit: { committedDate: "2026-09-05T10:00:00Z", statusCheckRollup: { state: "SUCCESS" } } }] }, ...extra,
  });
  return {
    execFile: Object.assign(() => {}, {
      [promisify.custom]: async (_bin: string, args: string[]) => {
        const q = args[args.indexOf("-f", 3) + 1];
        state.queries.push(q);
        const review = (state: string, submittedAt: string, login = "me") => ({ state, submittedAt, author: { login } });
        const pushedAt = (committedDate: string) => ({ commits: { nodes: [{ commit: { committedDate, statusCheckRollup: { state: "SUCCESS" } } }] } });
        const nodes = q.includes("reviewed-by:@me")
          ? [
              // reviewed, author pushed since: flagged as new work
              node(5, { author: { login: "teammate" }, reviews: { nodes: [review("CHANGES_REQUESTED", "2026-09-01T10:00:00Z")] }, ...pushedAt("2026-09-02T10:00:00Z") }),
              // asked for changes, nothing pushed since
              node(6, { author: { login: "teammate" }, reviews: { nodes: [review("CHANGES_REQUESTED", "2026-09-03T10:00:00Z")] }, ...pushedAt("2026-09-02T10:00:00Z") }),
              // approved, then pushed to: still flagged, still reachable
              node(7, { author: { login: "teammate" }, reviews: { nodes: [review("CHANGES_REQUESTED", "2026-09-01T10:00:00Z"), review("APPROVED", "2026-09-02T10:00:00Z")] }, ...pushedAt("2026-09-03T10:00:00Z") }),
              // the user's own review is not among the visible ones
              node(8, { author: { login: "teammate" }, reviews: { nodes: [review("CHANGES_REQUESTED", "2026-09-01T10:00:00Z", "someone")] }, ...pushedAt("2026-09-02T10:00:00Z") }),
              // already sitting in review-requested
              node(4, { author: { login: "teammate" }, reviews: { nodes: [review("CHANGES_REQUESTED", "2026-09-01T10:00:00Z")] }, ...pushedAt("2026-09-02T10:00:00Z") }),
            ]
          : q.includes("author:@me")
          ? [node(1, { commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }), node(2, { mergeable: "CONFLICTING", reviewDecision: "CHANGES_REQUESTED" }), node(3, { commits: { nodes: [] } })]
          : [node(4, { author: { login: "teammate" } })];
        return { stdout: JSON.stringify({ data: { viewer: { login: "me" }, search: { nodes } } }) };
      },
    }),
  };
});
const { attentionReasons, refreshPrInbox, getPrInbox, onPrInboxChanged } = await import("../src/main/prInbox.js");

describe("PR inbox", () => {
  it("fetches my PRs and review requests scoped to the owner, caches and notifies", async () => {
    const seen: unknown[] = [];
    onPrInboxChanged((inbox) => seen.push(inbox));
    const inbox = await refreshPrInbox();
    expect(state.queries).toEqual([
      "q=is:pr is:open archived:false author:@me user:acme",
      "q=is:pr is:open archived:false review-requested:@me user:acme",
      "q=is:pr is:open archived:false reviewed-by:@me user:acme",
    ]);
    expect(inbox.viewer).toBe("me");
    expect(inbox.mine.map((p) => p.number)).toEqual([3, 2, 1]);
    expect(inbox.mine.find((p) => p.number === 3)?.checks).toBe("NONE");
    expect(inbox.reviewRequested[0]).toMatchObject({ number: 4, author: "teammate" });
    expect(getPrInbox()).toEqual(inbox);
    expect(seen).toEqual([inbox]);
  });
  it("narrows to the listed repositories instead of the whole owner", async () => {
    state.repos = ["deck", "other/tool"];
    state.queries = [];
    await refreshPrInbox();
    expect(state.queries[0]).toBe("q=is:pr is:open archived:false author:@me repo:acme/deck repo:other/tool");
    state.repos = [];
  });
  it("keeps every open PR the user has reviewed, flagging the ones pushed to since", async () => {
    const inbox = await refreshPrInbox();
    // Membership comes from the reviewed-by:@me search; the flag is read off
    // the visible reviews, so 8 (no review of the user's among them) is kept
    // but unflagged. 4 is dropped as it already sits in reviewRequested.
    expect(inbox.reviewed.map((pr) => `${pr.number}:${pr.newSinceReview}`)).toEqual(["8:false", "7:true", "6:false", "5:true"]);
  });
  it("names what needs the author's attention", async () => {
    const inbox = await refreshPrInbox();
    const by = (n: number) => attentionReasons(inbox.mine.find((p) => p.number === n)!);
    expect(by(1)).toEqual(["ci_failed"]);
    expect(by(2)).toEqual(["changes_requested", "conflicts"]);
    expect(by(3)).toEqual([]);
  });
});
