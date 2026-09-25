import { boardProviderLabels, parseJiraUrl } from "../../shared/board.js";
import { getSettings } from "../settings.js";
import type { BoardProvider } from "./provider.js";
import type { BoardColumn, BoardColumnStatuses, BoardIssue, IssueHit, LinkedPullRequest, NewIssue } from "./types.js";

// Jira adapter, from slate's jira client. Configured entirely through
// settings (base url, email, api token, board id) — nothing vendor-specific
// in the rest of deck. The one write is moving a card between columns.

function config() {
  return getSettings().jira;
}

function baseUrl(): string {
  return parseJiraUrl(config().baseUrl).baseUrl;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const c = config();
  const auth = Buffer.from(`${c.email}:${c.apiToken}`).toString("base64");
  const res = await fetch(`${baseUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Jira ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  // Transitions answer 204 with an empty body.
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface Transitions {
  transitions: { id: string; name: string; to: { id: string; name: string } }[];
}

interface AgileConfiguration {
  columnConfig: { columns: { name: string; statuses: { id: string }[] }[] };
  /** Kanban board sub-filter — applied to the display, not the issue endpoint. */
  subQuery?: { query?: string };
}

interface AgileIssuePage {
  issues: {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: { id: string; name: string };
      assignee: { displayName: string; accountId: string } | null;
      updated: string;
      issuetype?: { name?: string; hierarchyLevel?: number };
    };
  }[];
  total: number;
}

interface DevStatusSummary {
  summary: { pullrequest?: { byInstanceType?: Record<string, unknown> } };
}

interface DevStatusDetail {
  detail: {
    pullRequests: {
      id: string;
      name: string;
      status: string;
      url: string;
      lastUpdate: string;
      repositoryName: string;
    }[];
  }[];
}

interface SearchPage {
  issues: {
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      issuetype: { name: string };
      assignee: { displayName: string } | null;
      priority: { name: string } | null;
      parent?: { key: string };
      updated: string;
      description?: unknown;
    };
  }[];
}

/** Flattens Atlassian Document Format to plain text; the agent only needs to read it. */
function adfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  const inner = (n.content ?? []).map(adfText).join(n.type === "paragraph" || n.type === "listItem" ? "" : "\n");
  return n.type === "paragraph" || n.type === "heading" ? `${inner}\n` : inner;
}

async function* pages(path: string, cap: number): AsyncGenerator<AgileIssuePage["issues"][number]> {
  for (let startAt = 0; startAt < cap; ) {
    const page = await request<AgileIssuePage>(`${path}&startAt=${startAt}&maxResults=100`);
    yield* page.issues;
    startAt += page.issues.length;
    if (startAt >= page.total || page.issues.length === 0) return;
  }
}

async function fetchBoard() {
  const c = config();
  const [board, conf, me] = await Promise.all([
    request<{ name: string }>(`/rest/agile/1.0/board/${c.boardId}`),
    request<AgileConfiguration>(`/rest/agile/1.0/board/${c.boardId}/configuration`),
    request<{ accountId: string }>("/rest/api/3/myself"),
  ]);
  const columns: BoardColumn[] = conf.columnConfig.columns.map((col) => ({
    name: col.name,
    statusIds: col.statuses.map((s) => s.id),
  }));

  // The issue endpoint applies the board filter but NOT the kanban
  // sub-filter, and returns epics that never show as cards — apply both
  // ourselves so counts match what Jira displays. The date guard keeps the
  // Done column from dragging in the board's entire history.
  const doneGuard = `statusCategory != Done OR statusCategoryChangedDate >= -${getSettings().board.doneWindowDays || 7}d`;
  const sub = conf.subQuery?.query?.trim();
  const jql = encodeURIComponent(sub ? `(${sub}) AND (${doneGuard})` : doneGuard);
  const issues: BoardIssue[] = [];
  for await (const i of pages(`/rest/agile/1.0/board/${c.boardId}/issue?jql=${jql}&fields=summary,status,assignee,updated,issuetype`, 1000)) {
    // Kanban cards are standard-level issues only: no epics (level 1+),
    // no sub-tasks (level -1).
    const t = i.fields.issuetype;
    const isCard = t?.hierarchyLevel != null ? t.hierarchyLevel === 0 : !/^(epic|sub-?task)$/i.test(t?.name ?? "");
    if (!isCard) continue;
    issues.push({
      id: i.id,
      key: i.key,
      summary: i.fields.summary,
      type: t?.name,
      statusId: i.fields.status.id,
      statusName: i.fields.status.name,
      assignee: i.fields.assignee?.displayName ?? null,
      assigneeId: i.fields.assignee?.accountId ?? null,
      updated: i.fields.updated,
      url: `${baseUrl()}/browse/${i.key}`,
    });
  }

  // The issue endpoint also returns the kanban backlog, which does not
  // belong on the board (it inflates the first column). Subtract it.
  const backlog = new Set<string>();
  for await (const i of pages(`/rest/agile/1.0/board/${c.boardId}/backlog?fields=status`, 2000)) backlog.add(i.key);

  return {
    boardName: board.name,
    columns,
    issues: issues.filter((i) => !backlog.has(i.key)),
    myAccountId: me.accountId,
  };
}

async function fetchColumns(): Promise<BoardColumnStatuses[]> {
  const [conf, statuses] = await Promise.all([
    request<AgileConfiguration>(`/rest/agile/1.0/board/${config().boardId}/configuration`),
    request<{ id: string; name: string }[]>("/rest/api/3/status"),
  ]);
  const names = new Map(statuses.map((s) => [s.id, s.name]));
  return conf.columnConfig.columns.map((col) => ({
    name: col.name,
    statuses: col.statuses.map((s) => ({ id: s.id, name: names.get(s.id) ?? s.id })),
  }));
}

/** Fires the workflow transition that lands in one of the column's statuses. */
async function moveIssue(issue: BoardIssue, column: BoardColumn) {
  const { transitions } = await request<Transitions>(`/rest/api/3/issue/${issue.key}/transitions`);
  // Several statuses can share a column (Done also holds Cancelled), so
  // prefer the status named like the column, then the column's own order.
  const transition =
    transitions.find((t) => t.to.name.toLowerCase() === column.name.toLowerCase()) ??
    column.statusIds.map((id) => transitions.find((t) => t.to.id === id)).find(Boolean);
  if (!transition) {
    throw new Error(`${issue.key} has no transition into "${column.name}" from its current status`);
  }
  await request(`/rest/api/3/issue/${issue.key}/transitions`, { transition: { id: transition.id } });
  return { statusId: transition.to.id, statusName: transition.to.name };
}

/** Pull requests the GitHub-for-Jira integration attached to an issue. The
 *  detail endpoint wants the integration's instance type, which the summary
 *  reports, so this is two requests instead of a hardcoded vendor string. */
async function linkedPullRequests(issue: BoardIssue): Promise<LinkedPullRequest[]> {
  const { summary } = await request<DevStatusSummary>(`/rest/dev-status/latest/issue/summary?issueId=${issue.id}`);
  const types = Object.keys(summary.pullrequest?.byInstanceType ?? {});
  const details = await Promise.all(
    types.map((type) =>
      request<DevStatusDetail>(
        `/rest/dev-status/latest/issue/detail?issueId=${issue.id}&applicationType=${encodeURIComponent(type)}&dataType=pullrequest`,
      ),
    ),
  );
  return details
    .flatMap((d) => d.detail)
    .flatMap((d) => d.pullRequests)
    .map((pr) => ({
      repo: pr.repositoryName,
      number: Number(pr.id.replace(/^#/, "")),
      title: pr.name,
      status: pr.status,
      url: pr.url,
      lastUpdate: pr.lastUpdate,
    }));
}

async function searchIssues(jql: string, max: number): Promise<IssueHit[]> {
  const page = await request<SearchPage>("/rest/api/3/search/jql", {
    jql,
    maxResults: max,
    fields: ["summary", "status", "issuetype", "assignee", "priority", "parent", "updated", "description"],
  });
  return page.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status.name,
    type: i.fields.issuetype.name,
    assignee: i.fields.assignee?.displayName ?? null,
    priority: i.fields.priority?.name ?? null,
    parent: i.fields.parent?.key ?? null,
    updated: i.fields.updated,
    description: adfText(i.fields.description).trim().slice(0, 1500),
    url: `${baseUrl()}/browse/${i.key}`,
  }));
}

async function createIssue(issue: NewIssue): Promise<{ key: string; url: string }> {
  const fields: Record<string, unknown> = {
    project: { key: issue.project },
    issuetype: { name: issue.type || "Task" },
    summary: issue.summary,
  };
  if (issue.description) {
    fields.description = {
      type: "doc",
      version: 1,
      content: issue.description.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
    };
  }
  if (issue.parent) fields.parent = { key: issue.parent };
  const created = await request<{ key: string }>("/rest/api/3/issue", { fields });
  return { key: created.key, url: `${baseUrl()}/browse/${created.key}` };
}

export const jiraProvider: BoardProvider = {
  kind: "jira",
  label: boardProviderLabels.jira,
  configured: () => {
    const c = config();
    return Boolean(c.baseUrl && c.email && c.apiToken && c.boardId);
  },
  fetchBoard,
  fetchColumns,
  moveIssue,
  linkedPullRequests,
  searchIssues,
  createIssue,
};
