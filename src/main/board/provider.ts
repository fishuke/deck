import type { BoardProviderKind } from "../../shared/settings.js";
import { getSettings } from "../settings.js";
import { githubProjectsProvider } from "./githubProjects.js";
import { jiraProvider } from "./jira.js";
import { linearProvider } from "./linear.js";
import type {
  BoardCache,
  BoardColumn,
  BoardColumnStatuses,
  BoardIssue,
  IssueHit,
  LinkedPullRequest,
  NewIssue,
} from "./types.js";

// The target interface of the adapter pattern: what deck's board needs from
// an issue tracker. board.ts (cache, local moves, sync loop) only ever talks
// to this; jira.ts, linear.ts and githubProjects.ts adapt their vendor APIs
// to it.

export interface BoardProvider {
  readonly kind: BoardProviderKind;
  /** Product name for labels such as "Open in Jira". */
  readonly label: string;
  /** Whether the connection block has everything needed to reach the board. */
  configured(): boolean;
  /** The whole board: name, columns and the cards on it. */
  fetchBoard(): Promise<Omit<BoardCache, "at" | "provider">>;
  /** Columns with their status names, for the settings page. */
  fetchColumns(): Promise<BoardColumnStatuses[]>;
  /** Moves an issue into a column and reports the status it landed in. */
  moveIssue(issue: BoardIssue, column: BoardColumn): Promise<{ statusId: string; statusName: string }>;
  /** Makes the authenticated user the issue's assignee and reports who that is. */
  assignToMe(issue: BoardIssue): Promise<{ assignee: string; assigneeId: string }>;
  /** Pull requests the tracker itself has attached to the issue. */
  linkedPullRequests(issue: BoardIssue): Promise<LinkedPullRequest[]>;
  /** Issues beyond the board, in the tracker's own query language. */
  searchIssues(query: string, max: number): Promise<IssueHit[]>;
  createIssue(issue: NewIssue): Promise<{ key: string; url: string }>;
}

const providers: Record<BoardProviderKind, BoardProvider> = {
  jira: jiraProvider,
  linear: linearProvider,
  github: githubProjectsProvider,
};

export function boardProvider(kind: BoardProviderKind = getSettings().board.provider): BoardProvider {
  return providers[kind] ?? providers.jira;
}
