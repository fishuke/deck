import { prsNeedingYou, readyToMerge, type Attention, type InboxPr } from "../../../shared/prs.js";

// What the agent page says is waiting on the user, as plain functions so the
// counting and the wording can be tested without a renderer.

export interface YourPr {
  pr: InboxPr;
  reasons: Attention[];
  ready: boolean;
}

/** Your own PRs that want a decision today: the broken ones first, then the
 *  ones with nothing left to do but merge. The rest are nobody's morning. */
export function yourPrs(mine: InboxPr[]): YourPr[] {
  const troubled = prsNeedingYou(mine).map(({ pr, reasons }) => ({ pr, reasons, ready: false }));
  const ready = mine
    .filter((pr) => readyToMerge(pr))
    .sort((first, second) => first.updatedAt.localeCompare(second.updatedAt))
    .map((pr) => ({ pr, reasons: [] as Attention[], ready: true }));
  return [...troubled, ...ready];
}

export interface Waiting {
  agents: number;
  prs: number;
  reviews: number;
}

/** How much is waiting, counted once so the page cannot disagree with itself. */
export function waitingCount(counts: Waiting): number {
  return counts.agents + counts.prs + counts.reviews;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export interface WaitingPart {
  text: string;
  /** What to ask deck about this part. The agent page answers here rather than
   *  sending the user to another page. */
  prompt: string;
}

/** What needs the user, in words, each part carrying the question it answers
 *  so the greeting is a way in rather than a statement. */
export function waitingParts(counts: Waiting): WaitingPart[] {
  return [
    counts.prs > 0 && {
      text: `${counts.prs} of your pull requests`,
      prompt: "Which of my pull requests need me, what is wrong with each, and which should I deal with first?",
    },
    counts.agents > 0 && {
      text: plural(counts.agents, "agent"),
      prompt: "Which agents are waiting on me, and what is each one asking for?",
    },
    counts.reviews > 0 && {
      text: plural(counts.reviews, "review"),
      prompt: "Which pull requests are waiting on my review, and which should I start with?",
    },
  ].filter((part): part is WaitingPart => Boolean(part));
}

/** The same parts as one sentence, for anywhere that cannot render links. */
export function waitingSummary(counts: Waiting): string {
  const parts = waitingParts(counts).map((part) => part.text);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Morning, afternoon or evening, for the greeting. */
export function partOfDay(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  return hour < 18 ? "afternoon" : "evening";
}
