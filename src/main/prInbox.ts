import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prKey, type InboxPr, type PrInbox } from "../shared/prs.js";
import { getBoardCache } from "./board/board.js";
import { githubScope } from "./github.js";
import { kvGet, kvSet } from "./db.js";
import { prsForIssue } from "./issuePrs.js";
import { getSettings } from "./settings.js";

const exec = promisify(execFile);

export { attentionReasons } from "../shared/prs.js";
export type { Attention, InboxPr, PrInbox } from "../shared/prs.js";

// The user's open pull requests and the ones waiting on their review, kept
// warm so the agent page can answer "what needs me?" without a round trip.
// One GraphQL search per list: gh's `search prs` cannot return checks or
// mergeability.

interface SearchNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null;
  mergeable: string;
  /** OPEN, CLOSED or MERGED; only looked at where the query is not is:open. */
  state?: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  commits: { nodes: { commit: { committedDate?: string; statusCheckRollup: { state: string } | null } }[] };
  reviews?: { nodes: { state: string; submittedAt: string; author: { login: string } | null }[] };
}

const PR_FIELDS = `number title url isDraft updatedAt headRefName baseRefName reviewDecision mergeable state
  author { login } repository { nameWithOwner }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  reviews(last: 20) { nodes { state submittedAt author { login } } }`;

const QUERY = `query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`;

function toPr(node: SearchNode): InboxPr {
  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? "",
    isDraft: node.isDraft,
    updatedAt: node.updatedAt,
    headRefName: node.headRefName,
    baseRefName: node.baseRefName,
    reviewDecision: node.reviewDecision,
    mergeable: node.mergeable ?? "UNKNOWN",
    checks: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "NONE",
  };
}

/** Whether the head commit is newer than the user's last review. False when
 *  no review of theirs is among the ones fetched. */
export function hasNewWorkSinceReview(node: SearchNode, viewer: string): boolean {
  const mine = (node.reviews?.nodes ?? []).filter((review) => review.author?.login === viewer && review.submittedAt);
  const last = mine[mine.length - 1];
  const pushed = node.commits.nodes[0]?.commit.committedDate;
  return Boolean(last && pushed && pushed > last.submittedAt);
}

/** Whether the user has submitted a review on this PR. */
function hasReviewFromViewer(node: SearchNode, viewer: string): boolean {
  return (node.reviews?.nodes ?? []).some((review) => review.author?.login === viewer && review.submittedAt);
}

const newestFirst = (a: InboxPr, b: InboxPr): number => b.updatedAt.localeCompare(a.updatedAt);

interface SearchResult {
  viewer: string;
  nodes: SearchNode[];
  prs: InboxPr[];
}

async function search(qualifier: string): Promise<SearchResult> {
  const q = `is:pr is:open archived:false ${qualifier} ${githubScope()}`.trim();
  const { stdout } = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=${q}`], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const data = (JSON.parse(stdout) as { data: { viewer: { login: string }; search: { nodes: SearchNode[] } } }).data;
  const nodes = data.search.nodes.filter((node) => node.number);
  return {
    viewer: data.viewer.login,
    nodes,
    prs: nodes.map(toPr).sort(newestFirst),
  };
}

// GitHub takes nothing else as an owner or repository name, and both go into
// the query as literals.
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BATCH = 25;

/** The PR state the review screen needs, for PRs the board pointed at: one
 *  aliased lookup each, since search cannot be handed a list of them. */
async function prsByRef(refs: { repo: string; number: number }[], viewer: string): Promise<InboxPr[]> {
  const prs: InboxPr[] = [];
  for (let from = 0; from < refs.length; from += BATCH) {
    const query = `query { ${refs.slice(from, from + BATCH).map(({ repo, number }, i) => {
      const [owner, name] = repo.split("/");
      return `pr${i}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { ${PR_FIELDS} } }`;
    }).join(" ")} }`;
    const { stdout } = await exec("gh", ["api", "graphql", "-f", `query=${query}`], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const repos = (JSON.parse(stdout) as { data: Record<string, { pullRequest: SearchNode | null } | null> }).data ?? {};
    for (const entry of Object.values(repos)) {
      const node = entry?.pullRequest;
      // The cache the refs came from can be minutes old, so a PR merged since
      // is only caught here.
      if (!node || node.state !== "OPEN" || node.author?.login === viewer) continue;
      prs.push({ ...toPr(node), newSinceReview: hasNewWorkSinceReview(node, viewer), reviewedByViewer: hasReviewFromViewer(node, viewer) });
    }
  }
  return prs.sort(newestFirst);
}

/** The open PRs of the cards sitting in the board's review columns. The
 *  tracker decides what is in the queue here; GitHub only fills in the state,
 *  so a PR reaches it whether or not the user was asked to review. */
async function reviewColumnPrs(viewer: string): Promise<InboxPr[]> {
  const { reviewSource, board: boardSettings } = getSettings();
  const board = getBoardCache();
  if (reviewSource !== "board" || !board) return [];
  const statusIds = new Set(board.columns.filter((c) => boardSettings.reviewColumns.includes(c.name)).flatMap((c) => c.statusIds));
  if (statusIds.size === 0) return [];
  const refs = new Map<string, { repo: string; number: number }>();
  for (const issue of board.issues.filter((i) => statusIds.has(i.statusId))) {
    const prs = await prsForIssue(issue.key, issue).catch(() => []);
    for (const pr of prs)
      if (pr.state === "OPEN" && REPO.test(pr.repo) && Number.isInteger(pr.number)) refs.set(prKey(pr), pr);
  }
  return prsByRef([...refs.values()], viewer);
}

const cacheKey = () => `pr_inbox@${getSettings().activeWorkspace}`;
const REFRESH_MS = 2 * 60_000;
const listeners = new Set<(inbox: PrInbox) => void>();
let timer: NodeJS.Timeout | undefined;
let inflight: Promise<PrInbox> | undefined;

export function onPrInboxChanged(cb: (inbox: PrInbox) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPrInbox(): PrInbox | undefined {
  return kvGet<PrInbox>(cacheKey());
}

/** The PRs waiting on the user, from wherever the reviews queue is sourced. */
export function prsAwaitingReview(inbox: PrInbox): InboxPr[] {
  return getSettings().reviewSource === "board" ? inbox.reviewColumn ?? [] : inbox.reviewRequested;
}

/** The PRs the user has reviewed, minus their own and the ones still sitting
 *  in reviewRequested. */
function reviewedByUser(reviewed: SearchResult, viewer: string, requested: InboxPr[]): InboxPr[] {
  const alreadyQueued = new Set(requested.map(prKey));
  return reviewed.nodes
    .map((node) => ({ ...toPr(node), newSinceReview: hasNewWorkSinceReview(node, viewer), reviewedByViewer: true }))
    .filter((pr) => pr.author !== viewer && !alreadyQueued.has(prKey(pr)))
    .sort(newestFirst);
}

function publish(inbox: PrInbox): PrInbox {
  kvSet(cacheKey(), inbox);
  for (const cb of listeners) cb(inbox);
  return inbox;
}

export function refreshPrInbox(): Promise<PrInbox> {
  inflight ??= Promise.all([search("author:@me"), search("review-requested:@me"), search("reviewed-by:@me")])
    .then(async ([mine, requested, reviewed]) => publish({
      viewer: mine.viewer,
      mine: mine.prs,
      reviewRequested: requested.prs,
      reviewed: reviewedByUser(reviewed, mine.viewer, requested.prs),
      // A board or GitHub hiccup here should not empty a queue that was fine
      // a moment ago.
      reviewColumn: await reviewColumnPrs(mine.viewer).catch(() => getPrInbox()?.reviewColumn ?? []),
      at: Date.now(),
    }))
    .finally(() => (inflight = undefined));
  return inflight;
}

export function startPrInbox(): void {
  const tick = () => void refreshPrInbox().catch(() => {});
  tick();
  timer = setInterval(tick, REFRESH_MS);
}

export function stopPrInbox(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
