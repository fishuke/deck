import { kvGet, kvSet } from "./db.js";
import { searchPrsForIssue, type IssuePr } from "./github.js";
import { linkedPullRequests, onBoardChanged, type BoardIssue } from "./board/board.js";
import { getSettings } from "./settings.js";

// PRs per board issue, kept warm in the background so opening a card never
// waits on a network round trip. The tracker's own PR links are the source;
// GitHub search is the fallback for issues its integration missed. Adapted
// from slate's prSearch warmer.

interface Entry {
  prs: IssuePr[];
  /** The issue's `updated` stamp when this was fetched — a moved card is
   *  refreshed at once, whatever its age. */
  issueUpdated: string;
  at: number;
}

const cacheKey = () => `issue_prs@${getSettings().activeWorkspace}`;
const FRESH_MS = 5 * 60_000;
const listeners = new Set<(key: string, prs: IssuePr[]) => void>();
const inflight = new Map<string, Promise<IssuePr[]>>();

function readCache(): Record<string, Entry> {
  return kvGet<Record<string, Entry>>(cacheKey()) ?? {};
}

export function onPrsChanged(
  cb: (key: string, prs: IssuePr[]) => void,
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const linkedState: Record<string, { state: string; isDraft: boolean }> = {
  OPEN: { state: "OPEN", isDraft: false },
  DRAFT: { state: "OPEN", isDraft: true },
  MERGED: { state: "MERGED", isDraft: false },
  DECLINED: { state: "CLOSED", isDraft: false },
};

async function fetchPrs(issue: BoardIssue): Promise<IssuePr[]> {
  const linked = await linkedPullRequests(issue).catch(() => []);
  if (linked.length === 0) return searchPrsForIssue(issue.key);
  return linked
    .map((pr) => ({
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      ...(linkedState[pr.status] ?? { state: pr.status, isDraft: false }),
      url: pr.url,
      // Trackers anonymise PR authors; the detail screen shows the real one.
      author: "",
      updatedAt: pr.lastUpdate,
    }))
    .sort((a, b) => b.number - a.number);
}

function refresh(issue: BoardIssue): Promise<IssuePr[]> {
  const running = inflight.get(issue.key);
  if (running) return running;
  const task = fetchPrs(issue)
    .then((prs) => {
      const cache = readCache();
      cache[issue.key] = { prs, issueUpdated: issue.updated, at: Date.now() };
      kvSet(cacheKey(), cache);
      for (const cb of listeners) cb(issue.key, prs);
      return prs;
    })
    .finally(() => inflight.delete(issue.key));
  inflight.set(issue.key, task);
  return task;
}

function isStale(entry: Entry | undefined, issue: BoardIssue): boolean {
  return (
    !entry ||
    entry.issueUpdated !== issue.updated ||
    Date.now() - entry.at > FRESH_MS
  );
}

/** Serves the cache and refreshes behind it; only an issue never seen by the
 *  warmer (or unknown to the board) waits on the lookup. */
export async function prsForIssue(
  key: string,
  issue?: BoardIssue,
): Promise<IssuePr[]> {
  const entry = readCache()[key];
  if (!issue) return entry?.prs ?? searchPrsForIssue(key);
  if (!entry) return refresh(issue);
  if (isStale(entry, issue)) void refresh(issue).catch(() => {});
  return entry.prs;
}

/** Walks the board one issue at a time — GitHub's search quota is small and
 *  this is background work — and drops issues that left the board. */
async function warm(issues: BoardIssue[]): Promise<void> {
  const cache = readCache();
  const onBoard = new Set(issues.map((i) => i.key));
  const kept = Object.fromEntries(
    Object.entries(cache).filter(([key]) => onBoard.has(key)),
  );
  if (Object.keys(kept).length !== Object.keys(cache).length)
    kvSet(cacheKey(), kept);
  for (const issue of issues) {
    if (isStale(readCache()[issue.key], issue))
      await refresh(issue).catch(() => {});
  }
}

let warming = false;

export function startPrWarmer(): void {
  onBoardChanged((board) => {
    if (warming) return;
    warming = true;
    void warm(board.issues).finally(() => {
      warming = false;
    });
  });
}
