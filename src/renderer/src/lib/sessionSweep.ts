import type { IssuePr } from "../../../main/github.js";
import type { SessionStatus } from "../../../main/sessions.js";

// What stands between a live agent session and being closed by the sweep.
// A session is done when the agent has nothing in flight, every pull request
// it opened is merged, and nothing exists only in its working tree.

export interface SweepFacts {
  status: SessionStatus;
  prs: IssuePr[];
  dirtyFiles: number;
}

export type SweepVerdict = "done" | "working" | "waiting" | "no-prs" | "open-prs" | "uncommitted";

export function sweepVerdict({ status, prs, dirtyFiles }: SweepFacts): SweepVerdict {
  if (status === "working") return "working";
  if (status === "needs_input" || status === "needs_review") return "waiting";
  if (prs.length === 0) return "no-prs";
  if (prs.some((pr) => pr.state !== "MERGED")) return "open-prs";
  if (dirtyFiles > 0) return "uncommitted";
  return "done";
}

export function sweepLabel(verdict: SweepVerdict, { prs, dirtyFiles }: SweepFacts): string {
  switch (verdict) {
    case "working": return "still working";
    case "waiting": return "waiting on you";
    case "no-prs": return "no pull requests";
    case "open-prs": {
      const open = prs.filter((pr) => pr.state !== "MERGED").length;
      return `${open} of ${prs.length} not merged`;
    }
    case "uncommitted": return `${dirtyFiles} uncommitted`;
    case "done": return "merged and clean";
  }
}
