import { useEffect, useMemo, useState } from "react";
import type { AgentSession } from "../../../main/sessions.js";
import { workspaceOf } from "../../../shared/settings.js";
import { useSettings } from "./useSettings.js";

/** Live agent-session list, kept in sync via sessions:changed pushes,
 *  narrowed to the active workspace. */
export function useAgentSessions(): AgentSession[] {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const settings = useSettings();
  useEffect(() => {
    void window.deck.sessions.list().then(setSessions);
    return window.deck.sessions.onChanged(setSessions);
  }, []);
  return useMemo(
    () => (settings ? sessions.filter((session) => workspaceOf(session.workspace, settings.workspaces) === settings.activeWorkspace) : sessions),
    [sessions, settings],
  );
}
