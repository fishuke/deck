import { describe, expect, it } from "vitest";
import type { IssuePr } from "../src/main/github.js";
import { sweepLabel, sweepVerdict, type SweepFacts } from "../src/renderer/src/lib/sessionSweep.js";

const pr = (number: number, state: string, isDraft = false): IssuePr => ({
  repo: "acme/api", number, title: `PR ${number}`, state, isDraft, url: `https://github.com/acme/api/pull/${number}`, author: "me", updatedAt: "",
});
const facts = (extra: Partial<SweepFacts>): SweepFacts => ({ status: "idle", prs: [pr(1, "MERGED")], dirtyFiles: 0, ...extra });

describe("sweepVerdict", () => {
  it("is done for an idle session whose pull requests all merged and whose tree is clean", () => {
    expect(sweepVerdict(facts({}))).toBe("done");
    expect(sweepLabel("done", facts({}))).toBe("merged and clean");
  });

  it("never touches a session that is working or waiting on the user", () => {
    expect(sweepVerdict(facts({ status: "working" }))).toBe("working");
    expect(sweepVerdict(facts({ status: "needs_input" }))).toBe("waiting");
    expect(sweepVerdict(facts({ status: "needs_review" }))).toBe("waiting");
  });

  it("keeps a session that opened nothing, since there is nothing to check", () => {
    expect(sweepVerdict(facts({ prs: [] }))).toBe("no-prs");
  });

  it("counts open, draft and closed pull requests as not merged", () => {
    const mixed = facts({ prs: [pr(1, "MERGED"), pr(2, "OPEN", true), pr(3, "CLOSED")] });
    expect(sweepVerdict(mixed)).toBe("open-prs");
    expect(sweepLabel("open-prs", mixed)).toBe("2 of 3 not merged");
  });

  it("keeps a session with uncommitted work even when everything merged", () => {
    const dirty = facts({ dirtyFiles: 2 });
    expect(sweepVerdict(dirty)).toBe("uncommitted");
    expect(sweepLabel("uncommitted", dirty)).toBe("2 uncommitted");
  });
});
