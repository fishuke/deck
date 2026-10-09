import { boardProviderLabels } from "../../shared/board.js";
import { graphql } from "../github.js";
import { getSettings } from "../settings.js";
import type { BoardProvider } from "./provider.js";
import type { BoardColumn, BoardColumnStatuses, BoardIssue, IssueHit, LinkedPullRequest, NewIssue } from "./types.js";

// GitHub Projects (v2) adapter, over the user's own `gh` auth. The project's
// Status field is the board: each option a column, items without one in the
// "No Status" column GitHub shows too. Only issues become cards; draft items
// and pull requests are left out.

const NO_STATUS: BoardColumn = { name: "No Status", statusIds: [""] };

// Epics hold other issues rather than being work themselves, so they are not
// cards; jira.ts drops its own parent level for the same reason.
const PARENT_TYPE = /^epic$/i;

function config() {
  return getSettings().githubProjects;
}

/** Owner may be a user or an organisation; both implement ProjectV2Owner. */
const PROJECT = `repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) {
  id title field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }`;

interface Project {
  id: string;
  title: string;
  field: { id: string; options: { id: string; name: string }[] } | null;
}

interface ProjectPage extends Project {
  items: { nodes: Item[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
}

interface BoardQuery {
  viewer: { login: string };
  repositoryOwner: { projectV2: ProjectPage | null } | null;
}

interface Item {
  id: string;
  updatedAt: string;
  fieldValueByName: { optionId?: string } | null;
  content: {
    number: number;
    title: string;
    url: string;
    updatedAt: string;
    state: "OPEN" | "CLOSED";
    closedAt: string | null;
    issueType: { name: string } | null;
    repository: { name: string };
    assignees: { nodes: { login: string }[] };
  } | null;
}

async function query<T>(text: string, variables: Record<string, string | number | boolean | null>): Promise<T> {
  const { data } = await graphql(text, variables);
  if (!data) throw new Error("GitHub returned no data");
  return data as T;
}

async function project(): Promise<Project> {
  const data = await query<{ repositoryOwner: { projectV2: Project | null } | null }>(
    `query($owner: String!, $number: Int!) { ${PROJECT} } } } }`,
    { owner: config().owner, number: Number(config().projectNumber) },
  );
  const found = data.repositoryOwner?.projectV2;
  if (!found) throw new Error(`GitHub project ${config().owner}/${config().projectNumber} not found`);
  return found;
}

function columnsOf(found: Project): BoardColumn[] {
  return [NO_STATUS, ...(found.field?.options ?? []).map((o) => ({ name: o.name, statusIds: [o.id] }))];
}

async function fetchBoard() {
  const owner = config().owner;
  const number = Number(config().projectNumber);
  const doneBefore = Date.now() - (getSettings().board.doneWindowDays || 7) * 86_400_000;
  let found: Project | undefined;
  let viewer = "";
  const issues: BoardIssue[] = [];
  let after: string | null = null;
  for (;;) {
    const data: BoardQuery = await query(
      `query($owner: String!, $number: Int!, $after: String) { viewer { login } ${PROJECT}
        items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id updatedAt
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } }
          content { ... on Issue { number title url updatedAt state closedAt issueType { name } repository { name } assignees(first: 3) { nodes { login } } } } } } } } } }`,
      { owner, number, after },
    );
    const page = data.repositoryOwner?.projectV2;
    if (!page) throw new Error(`GitHub project ${owner}/${number} not found`);
    found = page;
    viewer = data.viewer.login;
    for (const item of page.items.nodes) {
      const issue = item.content;
      if (!issue || (issue.state === "CLOSED" && issue.closedAt && Date.parse(issue.closedAt) < doneBefore)) continue;
      if (PARENT_TYPE.test(issue.issueType?.name ?? "")) continue;
      const optionId = item.fieldValueByName?.optionId ?? "";
      const login = issue.assignees.nodes[0]?.login ?? null;
      issues.push({
        id: item.id,
        key: `${issue.repository.name}#${issue.number}`,
        summary: issue.title,
        type: issue.issueType?.name,
        statusId: optionId,
        statusName: page.field?.options.find((o) => o.id === optionId)?.name ?? NO_STATUS.name,
        assignee: login,
        assigneeId: login,
        updated: issue.updatedAt > item.updatedAt ? issue.updatedAt : item.updatedAt,
        url: issue.url,
      });
    }
    if (!page.items.pageInfo.hasNextPage || !page.items.pageInfo.endCursor) break;
    after = page.items.pageInfo.endCursor;
  }
  if (!found) throw new Error(`GitHub project ${owner}/${number} not found`);
  return { boardName: found.title, columns: columnsOf(found), issues, myAccountId: viewer };
}

async function fetchColumns(): Promise<BoardColumnStatuses[]> {
  return columnsOf(await project()).map((c) => ({ name: c.name, statuses: [{ id: c.statusIds[0], name: c.name }] }));
}

async function moveIssue(issue: BoardIssue, column: BoardColumn) {
  const found = await project();
  if (!found.field) throw new Error("The project has no Status field to move cards in");
  const optionId = column.statusIds[0];
  const vars = { projectId: found.id, itemId: issue.id, fieldId: found.field.id };
  if (optionId) {
    await query(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }`,
      { ...vars, optionId },
    );
  } else {
    await query(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) { clearProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } } }`,
      vars,
    );
  }
  return { statusId: optionId, statusName: column.name };
}

/** Adds the viewer to the issue's assignees; GitHub allows several, and
 *  whoever is already on it stays. The card's id is the project item, so the
 *  issue behind it is looked up first. */
async function assignToMe(issue: BoardIssue) {
  const data = await query<{ viewer: { id: string; login: string }; node: { content: { id: string } | null } | null }>(
    `query($id: ID!) { viewer { id login } node(id: $id) { ... on ProjectV2Item { content { ... on Issue { id } } } } }`,
    { id: issue.id },
  );
  const issueId = data.node?.content?.id;
  if (!issueId) throw new Error(`${issue.key} is not an issue that can be assigned`);
  await query(
    `mutation($assignableId: ID!, $assigneeId: ID!) { addAssigneesToAssignable(input: {
      assignableId: $assignableId, assigneeIds: [$assigneeId] }) { clientMutationId } }`,
    { assignableId: issueId, assigneeId: data.viewer.id },
  );
  return { assignee: data.viewer.login, assigneeId: data.viewer.login };
}

interface PrNode {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  updatedAt: string;
  repository: { nameWithOwner: string };
}

/** Pull requests GitHub linked to the issue: "closes #12" keywords or the
 *  development sidebar. */
async function linkedPullRequests(issue: BoardIssue): Promise<LinkedPullRequest[]> {
  const data = await query<{ node: { content: { closedByPullRequestsReferences: { nodes: PrNode[] } } | null } | null }>(
    `query($id: ID!) { node(id: $id) { ... on ProjectV2Item { content { ... on Issue {
      closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes {
        number title url state isDraft updatedAt repository { nameWithOwner } } } } } } } }`,
    { id: issue.id },
  );
  return (data.node?.content?.closedByPullRequestsReferences.nodes ?? []).map((pr) => ({
    repo: pr.repository.nameWithOwner,
    number: pr.number,
    title: pr.title,
    status: pr.isDraft ? "DRAFT" : pr.state === "CLOSED" ? "DECLINED" : pr.state,
    url: pr.url,
    lastUpdate: pr.updatedAt,
  }));
}

interface SearchNode {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  body?: string;
  updatedAt?: string;
  repository?: { name: string };
  assignees?: { nodes: { login: string }[] };
  labels?: { nodes: { name: string }[] };
}

async function searchIssues(text: string, max: number): Promise<IssueHit[]> {
  const owner = config().owner;
  const scoped = /\b(org|user|repo):/.test(text) ? text : `${text} org:${owner}`;
  const data = await query<{ search: { nodes: SearchNode[] } }>(
    `query($q: String!, $first: Int!) { search(type: ISSUE, query: $q, first: $first) { nodes { ... on Issue {
      number title url state body updatedAt repository { name } assignees(first: 1) { nodes { login } } labels(first: 5) { nodes { name } } } } } }`,
    { q: `${scoped} is:issue`, first: max },
  );
  return data.search.nodes
    .filter((n) => n.number != null)
    .map((n) => ({
      key: `${n.repository?.name}#${n.number}`,
      summary: n.title ?? "",
      status: n.state ?? "",
      type: n.labels?.nodes.map((l) => l.name).join(", ") || "Issue",
      assignee: n.assignees?.nodes[0]?.login ?? null,
      priority: null,
      parent: null,
      updated: n.updatedAt ?? "",
      description: (n.body ?? "").trim().slice(0, 1500),
      url: n.url ?? "",
    }));
}

/** `project` is owner/repo, or just the repo under the project's owner. */
function repoOf(project: string): { owner: string; name: string } {
  const [owner, name] = project.includes("/") ? project.split("/") : [config().owner, project];
  return { owner, name };
}

async function createIssue(issue: NewIssue): Promise<{ key: string; url: string }> {
  const repo = repoOf(issue.project);
  const parent = issue.parent && /^(?:([^/#]+\/)?([^#]+))?#(\d+)$/.exec(issue.parent);
  const lookup = await query<{ repository: { id: string; parent?: { id: string } } | null }>(
    `query($owner: String!, $name: String!, $parentNumber: Int!, $withParent: Boolean!) { repository(owner: $owner, name: $name) { id
      parent: issue(number: $parentNumber) @include(if: $withParent) { id } } }`,
    { ...repo, parentNumber: parent ? Number(parent[3]) : 0, withParent: Boolean(parent) },
  );
  if (!lookup.repository) throw new Error(`Repository ${repo.owner}/${repo.name} not found`);
  const data = await query<{ createIssue: { issue: { id: string; number: number; url: string } } }>(
    `mutation($repositoryId: ID!, $title: String!, $body: String) { createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
      issue { id number url } } }`,
    { repositoryId: lookup.repository.id, title: issue.summary, body: issue.description ?? null },
  );
  const created = data.createIssue.issue;
  if (lookup.repository.parent) {
    await query(
      `mutation($issueId: ID!, $subIssueId: ID!) { addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) { issue { id } } }`,
      { issueId: lookup.repository.parent.id, subIssueId: created.id },
    );
  }
  return { key: `${repo.name}#${created.number}`, url: created.url };
}

export const githubProjectsProvider: BoardProvider = {
  kind: "github",
  label: boardProviderLabels.github,
  configured: () => Boolean(config().owner && config().projectNumber),
  fetchBoard,
  fetchColumns,
  moveIssue,
  assignToMe,
  linkedPullRequests,
  searchIssues,
  createIssue,
};
