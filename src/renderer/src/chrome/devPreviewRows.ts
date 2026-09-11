// Fake sidebar rows for every session state, shown only in `npm run dev`.
// Real rows need agent hooks, which only reach the build owning the server
// port, so these render from constants instead.

import type { AgentSession } from "../../../main/sessions.js";
import type { TermTab } from "../store.js";

export interface PreviewRow { tab: TermTab; session?: AgentSession }

const session = (status: AgentSession["status"], title: string): AgentSession => ({
  session_id: `preview:${status}`,
  agent: "claude",
  cwd: "/Users/you/Projects/deck",
  title,
  status,
  term_id: `preview:${status}`,
  transcript_path: null,
  issue_key: null,
  review_note: null,
  started_at: 0,
  updated_at: 0,
});

const tab = (id: string, title: string, tabColor?: string): TermTab =>
  ({ termId: `preview:${id}`, title, cwd: "/Users/you/Projects/deck", agent: "claude", tabColor });

export const previewRows: PreviewRow[] = [
  { tab: tab("working", "working"), session: session("working", "refactor the pty resize path") },
  { tab: tab("needs_input", "needs input"), session: session("needs_input", "run the migration on staging") },
  { tab: tab("needs_review", "needs review"), session: session("needs_review", "split the board filters out") },
  { tab: tab("idle", "idle"), session: session("idle", "add the letter spacing setting") },
  // No "ended" row: the sidebar drops those sessions before building a row.
  // No agent session: the badge takes the colour the program set.
  { tab: { termId: "preview:osc", title: "osc 6 colour", cwd: "/Users/you/Projects/deck", tabColor: "#3a7046" } },
  { tab: { termId: "preview:plain", title: "plain shell", cwd: "/Users/you/Projects/deck" } },
];
