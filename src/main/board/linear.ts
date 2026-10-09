import { boardProviderLabels } from "../../shared/board.js";
import { getSettings } from "../settings.js";
import type { BoardProvider } from "./provider.js";
import type { BoardColumn, BoardColumnStatuses, BoardIssue, IssueHit, LinkedPullRequest, NewIssue } from "./types.js";

// Linear adapter. A team's workflow states are the columns; the board leaves
// out the backlog states like Linear's own board view does.

const ENDPOINT = "https://api.linear.app/graphql";
/** Linear orders columns by state type, then by each state's position. */
const STATE_ORDER = ["triage", "unstarted", "started", "completed", "canceled"];

function config() {
  return getSettings().linear;
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: config().apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) {
    throw new Error(`Linear ${res.status}: ${json.errors?.map((e) => e.message).join("; ") ?? "request failed"}`);
  }
  return json.data as T;
}

interface State {
  id: string;
  name: string;
  type: string;
  position: number;
}

interface Team {
  id: string;
  name: string;
  states: { nodes: State[] };
}

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  updatedAt: string;
  state: { id: string; name: string };
  assignee: { id: string; name: string } | null;
}

interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

async function team(): Promise<Team> {
  const data = await graphql<{ teams: { nodes: Team[] } }>(
    `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id name states { nodes { id name type position } } } } }`,
    { key: config().teamKey },
  );
  const found = data.teams.nodes[0];
  if (!found) throw new Error(`Linear team ${config().teamKey} not found`);
  return found;
}

function boardStates(states: State[]): State[] {
  return states
    .filter((s) => s.type !== "backlog")
    .sort((a, b) => STATE_ORDER.indexOf(a.type) - STATE_ORDER.indexOf(b.type) || a.position - b.position);
}

async function fetchBoard() {
  const [{ viewer }, found] = await Promise.all([graphql<{ viewer: { id: string } }>("{ viewer { id } }"), team()]);
  const columns: BoardColumn[] = boardStates(found.states.nodes).map((s) => ({ name: s.name, statusIds: [s.id] }));
  const since = new Date(Date.now() - (getSettings().board.doneWindowDays || 7) * 86_400_000).toISOString();
  const filter = {
    team: { key: { eq: config().teamKey } },
    state: { type: { neq: "backlog" } },
    or: [
      { completedAt: { null: true }, canceledAt: { null: true } },
      { completedAt: { gte: since } },
      { canceledAt: { gte: since } },
    ],
  };
  const issues: BoardIssue[] = [];
  let after: string | null = null;
  for (;;) {
    const { issues: page }: { issues: Page<IssueNode> } = await graphql(
      `query($filter: IssueFilter, $after: String) { issues(first: 100, after: $after, filter: $filter) {
        nodes { id identifier title url updatedAt state { id name } assignee { id name } }
        pageInfo { hasNextPage endCursor } } }`,
      { filter, after },
    );
    for (const i of page.nodes) {
      issues.push({
        id: i.id,
        key: i.identifier,
        summary: i.title,
        statusId: i.state.id,
        statusName: i.state.name,
        assignee: i.assignee?.name ?? null,
        assigneeId: i.assignee?.id ?? null,
        updated: i.updatedAt,
        url: i.url,
      });
    }
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return { boardName: found.name, columns, issues, myAccountId: viewer.id };
}

async function fetchColumns(): Promise<BoardColumnStatuses[]> {
  const found = await team();
  return boardStates(found.states.nodes).map((s) => ({ name: s.name, statuses: [{ id: s.id, name: s.name }] }));
}

async function moveIssue(issue: BoardIssue, column: BoardColumn) {
  const stateId = column.statusIds[0];
  await graphql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, {
    id: issue.id,
    stateId,
  });
  return { statusId: stateId, statusName: column.name };
}

async function assignToMe(issue: BoardIssue) {
  const { viewer } = await graphql<{ viewer: { id: string; name: string } }>("{ viewer { id name } }");
  await graphql(`mutation($id: String!, $assigneeId: String!) { issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }`, {
    id: issue.id,
    assigneeId: viewer.id,
  });
  return { assignee: viewer.name, assigneeId: viewer.id };
}

interface Attachment {
  url: string;
  title: string;
  sourceType: string | null;
  updatedAt: string;
  metadata: { status?: string; draft?: boolean } | null;
}

/** GitHub pull requests show up on a Linear issue as attachments once the
 *  GitHub integration links them (magic words or branch name). */
async function linkedPullRequests(issue: BoardIssue): Promise<LinkedPullRequest[]> {
  const data = await graphql<{ issue: { attachments: { nodes: Attachment[] } } }>(
    `query($id: String!) { issue(id: $id) { attachments { nodes { url title sourceType updatedAt metadata } } } }`,
    { id: issue.id },
  );
  return data.issue.attachments.nodes.flatMap((a) => {
    const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(a.url);
    if (!match) return [];
    const status = a.metadata?.draft ? "DRAFT" : { merged: "MERGED", closed: "DECLINED" }[a.metadata?.status ?? ""] ?? "OPEN";
    return [{ repo: match[1], number: Number(match[2]), title: a.title, status, url: a.url, lastUpdate: a.updatedAt }];
  });
}

interface SearchNode {
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  updatedAt: string;
  priorityLabel: string;
  state: { name: string };
  assignee: { name: string } | null;
  parent: { identifier: string } | null;
  labels: { nodes: { name: string }[] };
}

async function searchIssues(term: string, max: number): Promise<IssueHit[]> {
  const data = await graphql<{ searchIssues: { nodes: SearchNode[] } }>(
    `query($term: String!, $first: Int!) { searchIssues(term: $term, first: $first) { nodes {
      identifier title url description updatedAt priorityLabel state { name } assignee { name } parent { identifier } labels { nodes { name } } } } }`,
    { term, first: max },
  );
  return data.searchIssues.nodes.map((i) => ({
    key: i.identifier,
    summary: i.title,
    status: i.state.name,
    type: i.labels.nodes.map((l) => l.name).join(", ") || "Issue",
    assignee: i.assignee?.name ?? null,
    priority: i.priorityLabel || null,
    parent: i.parent?.identifier ?? null,
    updated: i.updatedAt,
    description: (i.description ?? "").trim().slice(0, 1500),
    url: i.url,
  }));
}

async function createIssue(issue: NewIssue): Promise<{ key: string; url: string }> {
  const teams = await graphql<{ teams: { nodes: { id: string }[] } }>(
    `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`,
    { key: issue.project },
  );
  const teamId = teams.teams.nodes[0]?.id;
  if (!teamId) throw new Error(`Linear team ${issue.project} not found`);
  const parentId = issue.parent
    ? (await graphql<{ issue: { id: string } }>(`query($id: String!) { issue(id: $id) { id } }`, { id: issue.parent })).issue.id
    : undefined;
  const data = await graphql<{ issueCreate: { issue: { identifier: string; url: string } } }>(
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { identifier url } } }`,
    { input: { teamId, title: issue.summary, description: issue.description, parentId } },
  );
  return { key: data.issueCreate.issue.identifier, url: data.issueCreate.issue.url };
}

export const linearProvider: BoardProvider = {
  kind: "linear",
  label: boardProviderLabels.linear,
  configured: () => Boolean(config().apiKey && config().teamKey),
  fetchBoard,
  fetchColumns,
  moveIssue,
  assignToMe,
  linkedPullRequests,
  searchIssues,
  createIssue,
};
