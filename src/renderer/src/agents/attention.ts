import type { AgentSession } from "../../../main/sessions.js";
import { baseName } from "../../../shared/platform.js";
import { useAgentSessions } from "../lib/useSessions.js";

// What the agent page and the sidebar badge count as "needs me".

export const WAITING: AgentSession["status"][] = ["needs_input", "needs_review"];

export const isWaiting = (s: AgentSession): boolean => WAITING.includes(s.status);

export function project(cwd?: string | null): string {
  return (cwd && baseName(cwd)) || "~";
}

/** Waiting sessions: the badge on the agent page, dock and sidebar. */
export function useAttentionCount(): number {
  const sessions = useAgentSessions();
  return sessions.filter((session) => session.status !== "ended" && isWaiting(session)).length;
}
