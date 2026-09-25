import { kvGet, kvSet } from "../db.js";
import { getSettings } from "../settings.js";
import { boardProvider } from "./provider.js";
import type { BoardCache, BoardColumnStatuses, BoardIssue, IssueHit, LinkedPullRequest, NewIssue } from "./types.js";

// The board deck shows: a cached mirror of whichever tracker the provider
// adapter talks to, plus the moves deck made locally. Everything vendor
// specific sits behind boardProvider().

export type { BoardCache, BoardColumn, BoardColumnStatuses, BoardIssue, IssueHit, LinkedPullRequest, NewIssue } from "./types.js";

// Each workspace mirrors a board of its own, so its cache and local moves
// are keyed by workspace.
const cacheKey = () => `board_cache@${getSettings().activeWorkspace}`;
const localMovesKey = () => `board_local_moves@${getSettings().activeWorkspace}`;
const listeners = new Set<(b: BoardCache) => void>();
const errorListeners = new Set<(message: string) => void>();
let timer: NodeJS.Timeout | undefined;
let syncing = false;

export function boardConfigured(): boolean {
  return boardProvider().configured();
}

/** Cards moved on deck's board only, keyed by issue. Each remembers the
 *  tracker status it was moved away from: once the tracker reports anything
 *  else the move has been overtaken (its own automation caught up, or someone
 *  moved the card) and is dropped. */
interface LocalMove {
  fromStatusId: string;
  column: string;
}

function applyLocalMoves(raw: BoardCache): BoardCache {
  const moves = kvGet<Record<string, LocalMove>>(localMovesKey()) ?? {};
  const kept: Record<string, LocalMove> = {};
  const issues = raw.issues.map((issue) => {
    const move = moves[issue.key];
    const column = move && raw.columns.find((c) => c.name === move.column);
    if (!move || !column || issue.statusId !== move.fromStatusId) return issue;
    kept[issue.key] = move;
    return {
      ...issue,
      statusId: column.statusIds[0],
      statusName: column.name,
      localMove: true as const,
    };
  });
  if (Object.keys(kept).length !== Object.keys(moves).length) kvSet(localMovesKey(), kept);
  return { ...raw, issues };
}

/** Stores the tracker truth and hands listeners the board as deck shows it. */
function publish(raw: BoardCache): BoardCache {
  kvSet(cacheKey(), raw);
  const shown = applyLocalMoves(raw);
  for (const cb of listeners) cb(shown);
  return shown;
}

export function onBoardChanged(cb: (b: BoardCache) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** A sync that failed, so the board can say why it is stale or empty. */
export function onBoardSyncError(cb: (message: string) => void): () => void {
  errorListeners.add(cb);
  return () => errorListeners.delete(cb);
}

/** A cache synced by another provider is stale the moment the user switches;
 *  showing it would mix two trackers' columns. */
export function getBoardCache(): BoardCache | undefined {
  const raw = kvGet<BoardCache>(cacheKey());
  if (!raw || (raw.provider ?? "jira") !== boardProvider().kind) return undefined;
  return applyLocalMoves(raw);
}

/** Moves a card to a column through the provider. Updates the cache so the
 *  board reflects the move before the next sync. */
export async function moveIssue(key: string, columnName: string): Promise<BoardCache> {
  const cache = getBoardCache();
  const column = cache?.columns.find((c) => c.name === columnName);
  const issue = cache?.issues.find((i) => i.key === key);
  if (!cache || !column || !issue) throw new Error(`Unknown issue ${key} or column ${columnName}`);
  const landed = await boardProvider().moveIssue(issue, column);
  const raw = kvGet<BoardCache>(cacheKey()) ?? cache;
  return publish({
    ...raw,
    issues: raw.issues.map((i) => (i.key === key ? { ...i, ...landed } : i)),
  });
}

/** Runs the configured on-merge action for an issue: a move in the tracker,
 *  or a board-only move that keeps the card out of the way while the
 *  tracker's own automation is still on its way. */
export async function afterPrMerged(key: string): Promise<void> {
  const { onMerge } = getSettings().board;
  if (!onMerge.enabled || !onMerge.column) return;
  if (onMerge.mode === "remote") {
    await moveIssue(key, onMerge.column);
    return;
  }
  const raw = kvGet<BoardCache>(cacheKey());
  const issue = raw?.issues.find((i) => i.key === key);
  const column = raw?.columns.find((c) => c.name === onMerge.column);
  if (!raw || !issue || !column) {
    throw new Error(`Unknown issue ${key} or column ${onMerge.column}`);
  }
  if (column.statusIds.includes(issue.statusId)) return;
  const moves = kvGet<Record<string, LocalMove>>(localMovesKey()) ?? {};
  moves[key] = { fromStatusId: issue.statusId, column: column.name };
  kvSet(localMovesKey(), moves);
  publish(raw);
}

export async function syncBoard(): Promise<BoardCache | undefined> {
  const provider = boardProvider();
  if (!provider.configured() || syncing) return getBoardCache();
  syncing = true;
  try {
    const board = await provider.fetchBoard();
    return publish({ ...board, provider: provider.kind, at: Date.now() });
  } catch (error) {
    for (const cb of errorListeners) cb(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    syncing = false;
  }
}

/** Syncs unless the board was fetched moments ago, for when the user comes
 *  back to deck and expects what they just changed in the tracker. */
export function syncBoardIfStale(): void {
  if (Date.now() - (getBoardCache()?.at ?? 0) >= 30_000) void syncBoard().catch(() => {});
}

export function startBoardSync(): void {
  const tick = () => void syncBoard().catch(() => {});
  tick();
  timer = setInterval(tick, 60_000);
}

export function stopBoardSync(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** Live board columns with their status names, for the settings page. */
export function fetchBoardColumns(): Promise<BoardColumnStatuses[]> {
  const provider = boardProvider();
  return provider.configured() ? provider.fetchColumns() : Promise.resolve([]);
}

export function linkedPullRequests(issue: BoardIssue): Promise<LinkedPullRequest[]> {
  return boardProvider().linkedPullRequests(issue);
}

export function searchIssues(query: string, max = 25): Promise<IssueHit[]> {
  return boardProvider().searchIssues(query, Math.min(Math.max(max, 1), 50));
}

export function createIssue(issue: NewIssue): Promise<{ key: string; url: string }> {
  return boardProvider().createIssue(issue);
}
