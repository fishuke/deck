import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSettings } from "./settings.js";

const exec = promisify(execFile);

// PRs via the gh CLI (the user's own auth), adapted from slate's prSearch.
// Scoped to the configured owner when set, otherwise searches all of GitHub.
// This is the fallback for issues the tracker has no PR linked to; the cache that
// serves the board lives in issuePrs.ts.

export interface IssuePr {
  repo: string;
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string;
  updatedAt: string;
}

interface GhPrRow {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  updatedAt: string;
  author?: { login?: string };
  repository?: { nameWithOwner?: string };
}

/** Search qualifiers narrowing GitHub to the workspace: its repositories
 *  when any are listed, otherwise its owner; empty when neither is set. */
export function githubScope(): string {
  const { owner, repos } = getSettings().github;
  if (repos.length) return repos.map((repo) => `repo:${repo.includes("/") ? repo : `${owner}/${repo}`}`).join(" ");
  return owner ? `user:${owner}` : "";
}

export async function searchPrsForIssue(issueKey: string): Promise<IssuePr[]> {
  const args = [
    "search",
    "prs",
    `${issueKey} ${githubScope()}`.trim(),
    "--limit",
    "15",
    "--json",
    "number,title,state,isDraft,url,updatedAt,author,repository",
  ];
  try {
    const { stdout } = await exec("gh", args, { timeout: 20_000 });
    return (JSON.parse(stdout) as GhPrRow[])
      .map((r) => ({
        repo: r.repository?.nameWithOwner ?? "",
        number: r.number,
        title: r.title,
        state: r.state,
        isDraft: r.isDraft,
        url: r.url,
        author: r.author?.login ?? "",
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => b.number - a.number);
  } catch {
    return [];
  }
}

/** One pull request as the search rows above describe it, or null when gh
 *  cannot see it (deleted, private to another account, offline). */
export async function prSummary(repo: string, number: number): Promise<IssuePr | null> {
  try {
    const { stdout } = await exec(
      "gh",
      ["pr", "view", String(number), "-R", repo, "--json", "number,title,state,isDraft,url,updatedAt,author"],
      { timeout: 20_000 },
    );
    const row = JSON.parse(stdout) as GhPrRow;
    return {
      repo,
      number: row.number,
      title: row.title,
      state: row.state,
      isDraft: row.isDraft,
      url: row.url,
      author: row.author?.login ?? "",
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export type MergeMethod = "merge" | "squash" | "rebase";

export interface PrCheck {
  name: string;
  state: string;
  url: string | null;
}

export interface PrReviewer {
  login: string;
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED or PENDING for an open request. */
  state: string;
}

export interface PrCommit {
  oid: string;
  headline: string;
  author: string;
  date: string;
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  /** GitHub's own "Viewed" checkbox, so review progress follows the user across tools. */
  viewed: boolean;
}

export interface PrDetail {
  /** GraphQL node id, needed by the viewed-file mutations. */
  id: string;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string;
  /** The gh user, so the UI knows whether it is looking at its own PR. */
  viewer: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
  /** MERGEABLE, CONFLICTING or UNKNOWN. */
  mergeable: string;
  /** CLEAN, BEHIND, BLOCKED, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT or UNKNOWN. */
  mergeStateStatus: string;
  checks: PrCheck[];
  /** Merge methods the repo allows, in GitHub's merge/squash/rebase order. */
  mergeMethods: MergeMethod[];
  reviewers: PrReviewer[];
  /** Set when someone enabled GitHub auto-merge; it fires once requirements pass. */
  autoMerge: { method: MergeMethod; by: string } | null;
  commits: PrCommit[];
  linkedIssues: { number: number; title: string; url: string }[];
  files: PrFile[];
}

let viewer: Promise<string> | undefined;

const viewerLogin = (): Promise<string> =>
  (viewer ??= exec("gh", ["api", "user", "--jq", ".login"], { timeout: 20_000 })
    .then(({ stdout }) => stdout.trim())
    .catch(() => ""));

async function allowedMergeMethods(repo: string): Promise<MergeMethod[]> {
  try {
    const { stdout } = await exec(
      "gh",
      ["repo", "view", repo, "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"],
      { timeout: 20_000 },
    );
    const repoView = JSON.parse(stdout) as {
      mergeCommitAllowed: boolean;
      squashMergeAllowed: boolean;
      rebaseMergeAllowed: boolean;
    };
    const methods: MergeMethod[] = [];
    if (repoView.mergeCommitAllowed) methods.push("merge");
    if (repoView.squashMergeAllowed) methods.push("squash");
    if (repoView.rebaseMergeAllowed) methods.push("rebase");
    return methods.length > 0 ? methods : ["merge"];
  } catch {
    return ["merge"];
  }
}

const FILES_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions viewerViewedState }
      }
    }
  }
}`;

interface GhFileNode {
  path: string;
  additions: number;
  deletions: number;
  viewerViewedState: "VIEWED" | "UNVIEWED" | "DISMISSED";
}

/** GraphQL over the user's gh auth. Strings go raw (-f); numbers and booleans
 *  typed (-F), so a title that happens to read "123" stays a string. */
/** What went wrong with a gh call, in one line the user can act on. gh echoes
 *  the whole command and repeats a scope complaint once per field, none of
 *  which belongs on a settings page. */
function ghError(error: unknown): Error {
  const { code, stderr = "", message = "" } = error as { code?: string; stderr?: string; message?: string };
  if (code === "ENOENT") return new Error("The GitHub CLI (gh) is not installed.");
  const scope = /requires one of the following scopes: \['([^']+)'/.exec(stderr)?.[1];
  if (scope) return new Error(`Your gh login is missing the ${scope} scope. Run: gh auth refresh -s ${scope}`);
  if (/not logged in|gh auth login/i.test(stderr)) return new Error("Not logged in to GitHub. Run: gh auth login");
  const line = stderr.split("\n").find((l) => l.trim()) ?? message.split("\n")[0];
  return new Error(line.replace(/^gh:\s*/, "").trim() || "GitHub request failed");
}

export async function graphql(query: string, variables: Record<string, string | number | boolean | null>) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value !== null) args.push(typeof value === "string" ? "-f" : "-F", `${key}=${value}`);
  }
  try {
    const { stdout } = await exec("gh", args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout) as { data?: Record<string, unknown> };
  } catch (error) {
    throw ghError(error);
  }
}

// The REST `files` field lacks the viewed state, so files come from GraphQL.
async function prFiles(repo: string, number: number): Promise<PrFile[]> {
  const [owner, name] = repo.split("/");
  const files: PrFile[] = [];
  let after: string | null = null;
  try {
    do {
      const page = (await graphql(FILES_QUERY, { owner, name, number, after })).data as
        | {
            repository?: {
              pullRequest?: {
                files: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GhFileNode[] };
              };
            };
          }
        | undefined;
      const connection = page?.repository?.pullRequest?.files;
      if (!connection) break;
      for (const node of connection.nodes) {
        files.push({
          path: node.path,
          additions: node.additions,
          deletions: node.deletions,
          viewed: node.viewerViewedState === "VIEWED",
        });
      }
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
  } catch {
    // A partial list beats no detail at all.
  }
  return files;
}

interface GhCheckRollup {
  name?: string;
  context?: string;
  state?: string;
  conclusion?: string;
  status?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

interface GhPrView {
  id: string;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: { login?: string } | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
  mergeable: string;
  mergeStateStatus: string;
  statusCheckRollup: GhCheckRollup[] | null;
  reviewRequests: ({ login?: string } | { name?: string; slug?: string })[];
  latestReviews: { author: { login: string }; state: string }[];
  autoMergeRequest: { mergeMethod: string; enabledBy?: { login?: string } } | null;
  commits: {
    oid: string;
    messageHeadline: string;
    authors: { login?: string; name?: string }[];
    committedDate: string;
  }[];
  closingIssuesReferences: { number: number; title: string; url: string }[];
}

const PR_VIEW_FIELDS = [
  "id",
  "title",
  "body",
  "state",
  "isDraft",
  "url",
  "author",
  "baseRefName",
  "headRefName",
  "headRefOid",
  "additions",
  "deletions",
  "reviewDecision",
  "mergeable",
  "mergeStateStatus",
  "statusCheckRollup",
  "reviewRequests",
  "latestReviews",
  "autoMergeRequest",
  "commits",
  "closingIssuesReferences",
].join(",");

export async function prDetail(repo: string, number: number): Promise<PrDetail | null> {
  try {
    const [{ stdout }, mergeMethods, files, viewer] = await Promise.all([
      exec("gh", ["pr", "view", String(number), "-R", repo, "--json", PR_VIEW_FIELDS], {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
      allowedMergeMethods(repo),
      prFiles(repo, number),
      viewerLogin(),
    ]);
    const raw = JSON.parse(stdout) as GhPrView;

    // Open requests first, then whoever already reviewed; a login appears once.
    const reviewers: PrReviewer[] = [];
    for (const request of raw.reviewRequests ?? []) {
      const login = "login" in request && request.login ? request.login : "name" in request ? request.name : undefined;
      if (login) reviewers.push({ login, state: "PENDING" });
    }
    for (const review of raw.latestReviews ?? []) {
      const login = review.author?.login;
      if (!login || reviewers.some((r) => r.login === login)) continue;
      reviewers.push({ login, state: review.state });
    }

    return {
      id: raw.id,
      title: raw.title,
      body: raw.body ?? "",
      state: raw.state,
      isDraft: raw.isDraft,
      url: raw.url,
      author: raw.author?.login ?? "",
      viewer,
      baseRefName: raw.baseRefName,
      headRefName: raw.headRefName,
      headRefOid: raw.headRefOid,
      additions: raw.additions,
      deletions: raw.deletions,
      reviewDecision: raw.reviewDecision,
      mergeable: raw.mergeable ?? "UNKNOWN",
      mergeStateStatus: raw.mergeStateStatus ?? "UNKNOWN",
      checks: (raw.statusCheckRollup ?? []).map((c) => ({
        name: c.name ?? c.context ?? "check",
        state: c.conclusion ?? c.state ?? c.status ?? "",
        url: c.detailsUrl ?? c.targetUrl ?? null,
      })),
      mergeMethods,
      reviewers,
      autoMerge: raw.autoMergeRequest
        ? {
            method: raw.autoMergeRequest.mergeMethod.toLowerCase() as MergeMethod,
            by: raw.autoMergeRequest.enabledBy?.login ?? "",
          }
        : null,
      commits: (raw.commits ?? []).map((c) => ({
        oid: c.oid,
        headline: c.messageHeadline,
        author: c.authors?.[0]?.login || c.authors?.[0]?.name || "",
        date: c.committedDate,
      })),
      linkedIssues: raw.closingIssuesReferences ?? [],
      files,
    };
  } catch {
    return null;
  }
}

export async function setPrFileViewed(
  pullRequestId: string,
  path: string,
  viewed: boolean,
): Promise<PrActionResult> {
  const mutation = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
  try {
    await graphql(
      `mutation($id: ID!, $path: String!) {
        ${mutation}(input: { pullRequestId: $id, path: $path }) { clientMutationId }
      }`,
      { id: pullRequestId, path },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

export async function replyToThread(threadId: string, body: string): Promise<PrActionResult> {
  try {
    await graphql(
      `mutation($id: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
          comment { id }
        }
      }`,
      { id: threadId, body },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

export async function setThreadResolved(threadId: string, resolved: boolean): Promise<PrActionResult> {
  const mutation = resolved ? "resolveReviewThread" : "unresolveReviewThread";
  try {
    await graphql(
      `mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { id } } }`,
      { id: threadId },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

/** A plain conversation comment on the PR, outside any review. */
export async function addPrComment(repo: string, number: number, body: string): Promise<PrActionResult> {
  try {
    const pending = exec("gh", ["pr", "comment", String(number), "-R", repo, "--body-file", "-"], {
      timeout: 30_000,
    });
    pending.child.stdin?.end(body);
    await pending;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

/** Raw file content at a ref, for expanding the unchanged lines around a hunk. */
export async function fileContent(repo: string, ref: string, path: string): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  try {
    const { stdout } = await exec(
      "gh",
      ["api", `repos/${repo}/contents/${encoded}?ref=${ref}`, "-H", "Accept: application/vnd.github.raw+json"],
      { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return null;
  }
}

// Review feedback (Copilot and humans), adapted from slate's prComments.
// Thread comments carry the thread's anchor so they render inline in the diff;
// review-level bodies (Copilot's summary, a human's overall note) have none.
export type PrTimelineKind =
  | "opened"
  | "commits"
  | "force_pushed"
  | "review_requested"
  | "reviewed"
  | "ready_for_review"
  | "auto_merge_enabled"
  | "auto_merge_disabled"
  | "merged"
  | "closed"
  | "reopened";

export interface PrTimelineEvent {
  kind: PrTimelineKind;
  actor: string;
  date: string;
  /** Reviewer for review requests, review state for reviews, commit count for pushes. */
  detail: string;
}

const TIMELINE_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      createdAt
      author { login }
      timelineItems(first: 250, itemTypes: [
        PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT, REVIEW_REQUESTED_EVENT,
        PULL_REQUEST_REVIEW, READY_FOR_REVIEW_EVENT, AUTO_MERGE_ENABLED_EVENT,
        AUTO_MERGE_DISABLED_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT
      ]) {
        nodes {
          __typename
          ... on PullRequestCommit { commit { committedDate author { user { login } name } } }
          ... on HeadRefForcePushedEvent { createdAt actor { login } }
          ... on ReviewRequestedEvent {
            createdAt actor { login }
            requestedReviewer { ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { name } }
          }
          ... on PullRequestReview { submittedAt state author { login } }
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on AutoMergeEnabledEvent { createdAt actor { login } }
          ... on AutoMergeDisabledEvent { createdAt actor { login } }
          ... on MergedEvent { createdAt actor { login } }
          ... on ClosedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
        }
      }
    }
  }
}`;

interface GhTimelineNode {
  __typename: string;
  createdAt?: string;
  submittedAt?: string;
  state?: string;
  actor?: { login?: string } | null;
  author?: { login?: string } | null;
  requestedReviewer?: { login?: string; name?: string } | null;
  commit?: { committedDate: string; author: { user: { login?: string } | null; name?: string } | null };
}

const timelineKinds: Record<string, PrTimelineKind> = {
  HeadRefForcePushedEvent: "force_pushed",
  ReviewRequestedEvent: "review_requested",
  PullRequestReview: "reviewed",
  ReadyForReviewEvent: "ready_for_review",
  AutoMergeEnabledEvent: "auto_merge_enabled",
  AutoMergeDisabledEvent: "auto_merge_disabled",
  MergedEvent: "merged",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
};

/** What GitHub shows in its conversation tab, minus the comments (those come from prComments). */
export async function prTimeline(repo: string, number: number): Promise<PrTimelineEvent[]> {
  const [owner, name] = repo.split("/");
  try {
    const data = (await graphql(TIMELINE_QUERY, { owner, name, number })).data as
      | {
          repository?: {
            pullRequest?: {
              createdAt: string;
              author: { login?: string } | null;
              timelineItems: { nodes: GhTimelineNode[] };
            };
          };
        }
      | undefined;
    const pr = data?.repository?.pullRequest;
    if (!pr) return [];

    const events: PrTimelineEvent[] = [
      { kind: "opened", actor: pr.author?.login ?? "", date: pr.createdAt, detail: "" },
    ];
    for (const node of pr.timelineItems.nodes) {
      if (node.__typename === "PullRequestCommit") {
        // Consecutive commits by one author collapse into a single "pushed N commits" row.
        const actor = node.commit?.author?.user?.login || node.commit?.author?.name || "";
        const last = events[events.length - 1];
        if (last.kind === "commits" && last.actor === actor) {
          last.detail = String(Number(last.detail) + 1);
          last.date = node.commit?.committedDate ?? last.date;
        } else events.push({ kind: "commits", actor, date: node.commit?.committedDate ?? "", detail: "1" });
        continue;
      }
      const kind = timelineKinds[node.__typename];
      if (!kind) continue;
      // Pending reviews and empty COMMENTED reviews are noise GitHub hides too.
      if (kind === "reviewed" && (node.state === "PENDING" || node.state === "COMMENTED")) continue;
      events.push({
        kind,
        actor: node.actor?.login ?? node.author?.login ?? "",
        date: node.createdAt ?? node.submittedAt ?? "",
        detail: node.requestedReviewer?.login ?? node.requestedReviewer?.name ?? node.state ?? "",
      });
    }
    return events;
  } catch {
    return [];
  }
}

export interface PrComment {
  id: number;
  /** Review thread node id; null for review bodies and plain PR comments. */
  threadId: string | null;
  author: string;
  isBot: boolean;
  body: string;
  path: string | null;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  url: string;
  createdAt: string;
}

const COMMENTS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 20) {
            nodes { databaseId body url createdAt author { login } }
          }
        }
      }
      reviews(first: 50) {
        nodes { databaseId body url createdAt state author { login } }
      }
      comments(first: 100) {
        nodes { databaseId body url createdAt author { login } }
      }
    }
  }
}`;

// Copilot posts this instead of a review when the requester is out of quota.
const NOISE = /unable to review this pull request|reached their quota limit/i;

const isBotLogin = (login: string): boolean => /\[bot\]$/i.test(login) || /copilot/i.test(login);

interface CommentNode {
  databaseId: number;
  body: string;
  url: string;
  createdAt: string;
  author: { login: string } | null;
}

export async function prComments(repo: string, number: number): Promise<PrComment[]> {
  const [owner, name] = repo.split("/");
  try {
    const { stdout } = await exec(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=${COMMENTS_QUERY}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${number}`,
      ],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const pr = (
      JSON.parse(stdout) as {
        data?: {
          repository?: {
            pullRequest?: {
              reviewThreads: {
                nodes: {
                  id: string;
                  isResolved: boolean;
                  isOutdated: boolean;
                  path: string | null;
                  line: number | null;
                  comments: { nodes: CommentNode[] };
                }[];
              };
              reviews: { nodes: (CommentNode & { state: string })[] };
              comments: { nodes: CommentNode[] };
            };
          };
        };
      }
    ).data?.repository?.pullRequest;
    if (!pr) return [];

    const comments: PrComment[] = [];
    for (const review of [...pr.reviews.nodes, ...pr.comments.nodes]) {
      const body = review.body?.trim();
      if (!body || NOISE.test(body)) continue;
      const author = review.author?.login ?? "unknown";
      comments.push({
        id: review.databaseId,
        threadId: null,
        author,
        isBot: isBotLogin(author),
        body,
        path: null,
        line: null,
        resolved: false,
        outdated: false,
        url: review.url,
        createdAt: review.createdAt,
      });
    }
    for (const thread of pr.reviewThreads.nodes) {
      for (const node of thread.comments.nodes) {
        const author = node.author?.login ?? "unknown";
        comments.push({
          id: node.databaseId,
          threadId: thread.id,
          author,
          isBot: isBotLogin(author),
          body: node.body,
          path: thread.path,
          line: thread.line,
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
          url: node.url,
          createdAt: node.createdAt,
        });
      }
    }
    return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export type PrActionResult = { ok: true } | { ok: false; error: string };

const firstLine = (err: unknown): string =>
  err instanceof Error ? err.message.split("\n")[0] : "error";

export type ReviewEvent = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

/** One line comment as GitHub takes it: a range is the same shape with a start. */
export interface DraftComment {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number | null;
  body: string;
}

/**
 * Submits one review carrying every drafted line comment at once, which is what
 * GitHub's own review flow does: half-finished thoughts should not arrive on
 * the PR one notification at a time. Adapted from slate's submitReview.
 */
export async function submitPrReview(
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
  comments: DraftComment[],
): Promise<PrActionResult> {
  const payload = JSON.stringify({
    event,
    body,
    comments: comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      // GitHub rejects a start equal to the end, so a one-line range is sent
      // as the single line it actually is.
      ...(comment.startLine && comment.startLine < comment.line
        ? { start_line: comment.startLine, start_side: comment.side }
        : {}),
      body: comment.body,
    })),
  });
  try {
    const pending = exec(
      "gh",
      ["api", "--method", "POST", `repos/${repo}/pulls/${number}/reviews`, "--input", "-"],
      { timeout: 30_000 },
    );
    pending.child.stdin?.end(payload);
    await pending;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

// Guards mirror slate's merge route: refuse drafts, conflicts and red checks
// with a readable message instead of letting gh fail with a worse one.
export async function mergePr(
  repo: string,
  number: number,
  method: MergeMethod,
): Promise<PrActionResult> {
  try {
    const { stdout } = await exec(
      "gh",
      ["pr", "view", String(number), "-R", repo, "--json", "mergeable,isDraft,statusCheckRollup"],
      { timeout: 20_000 },
    );
    const view = JSON.parse(stdout) as {
      mergeable: string;
      isDraft: boolean;
      statusCheckRollup: { status?: string; conclusion?: string }[] | null;
    };
    if (view.isDraft) {
      return { ok: false, error: "PR is still a draft; mark it ready on GitHub first." };
    }
    if (view.mergeable === "CONFLICTING") {
      return { ok: false, error: "PR has conflicts; resolve them first." };
    }
    const failing = (view.statusCheckRollup ?? []).filter(
      (check) =>
        check.status === "COMPLETED" &&
        !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.conclusion ?? ""),
    );
    if (failing.length > 0) {
      return { ok: false, error: `${failing.length} check(s) failing; nothing to merge yet.` };
    }
    await exec("gh", ["pr", "merge", String(number), "-R", repo, `--${method}`], {
      timeout: 30_000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

/** Asks GitHub to merge on its own once checks and reviews allow it. */
export async function enableAutoMerge(
  repo: string,
  number: number,
  method: MergeMethod,
): Promise<PrActionResult> {
  try {
    await exec("gh", ["pr", "merge", String(number), "-R", repo, "--auto", `--${method}`], {
      timeout: 30_000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

export async function prDiff(repo: string, number: number): Promise<string> {
  try {
    const { stdout } = await exec("gh", ["pr", "diff", String(number), "-R", repo], {
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    // A pathological diff should degrade, not hang the renderer.
    return stdout.length > 2_000_000 ? stdout.slice(0, 2_000_000) : stdout;
  } catch (err) {
    return `diff unavailable: ${err instanceof Error ? err.message.split("\n")[0] : "error"}`;
  }
}

export interface StackedPr {
  number: number;
  title: string;
  author: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
}

/** A PR's place in a branch stack: the PRs it is stacked on, nearest first,
 *  and the ones stacked on it. Only plain-git stacking is visible this way,
 *  and a PR with several children is followed down its first one. */
export interface PrStack {
  below: StackedPr[];
  above: StackedPr[];
}

/** Longest chain resolved in either direction. */
const MAX_STACK = 10;

interface RestPr {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  updated_at: string;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
}

const toStacked = (pr: RestPr): StackedPr => ({
  number: pr.number,
  title: pr.title,
  author: pr.user?.login ?? "",
  url: pr.html_url,
  isDraft: pr.draft,
  updatedAt: pr.updated_at,
  headRefName: pr.head.ref,
  baseRefName: pr.base.ref,
});

async function openPrs(repo: string, filter: string): Promise<StackedPr[]> {
  try {
    const { stdout } = await exec("gh", ["api", `repos/${repo}/pulls?state=open&per_page=20&${filter}`], { timeout: 20_000 });
    return (JSON.parse(stdout) as RestPr[]).map(toStacked);
  } catch {
    return [];
  }
}

export async function prStack(repo: string, headRefName: string, baseRefName: string, number: number): Promise<PrStack> {
  const owner = repo.split("/")[0];
  const seen = new Set([number]);
  const walk = async (from: string, next: (pr: StackedPr) => string, filter: (ref: string) => string) => {
    const chain: StackedPr[] = [];
    let ref = from;
    while (ref && chain.length < MAX_STACK) {
      const [found] = await openPrs(repo, filter(ref));
      if (!found || seen.has(found.number)) break;
      seen.add(found.number);
      chain.push(found);
      ref = next(found);
    }
    return chain;
  };
  const [below, above] = await Promise.all([
    walk(baseRefName, (pr) => pr.baseRefName, (ref) => `head=${owner}:${ref}`),
    walk(headRefName, (pr) => pr.headRefName, (ref) => `base=${ref}`),
  ]);
  return { below, above };
}
