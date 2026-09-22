export type Agent = "claude" | "codex";

export const agentLabels: Record<Agent, string> = { claude: "Claude", codex: "Codex" };

export function sessionKey(agent: Agent, id: string): string {
  return agent === "codex" && !id.startsWith("codex:") ? `codex:${id}` : id;
}

export function sessionAgent(id: string): Agent {
  return id.startsWith("codex:") ? "codex" : "claude";
}

/** The title a session takes from its first prompt. Claude Code wraps every
 *  paste in `<pasted_content>` tags; the tags go, the pasted text stays. */
export function promptTitle(prompt: string): string {
  return prompt.replace(/<\/?pasted_content[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function shellQuote(text: string): string {
  return "'" + text.replaceAll("'", "'\"'\"'") + "'";
}

export interface AgentLaunch {
  agent?: Agent;
  sessionId?: string;
  prompt?: string;
}

export function agentCommand({ agent = "claude", sessionId, prompt }: AgentLaunch): string {
  const parts: string[] = [agent];
  if (sessionId) {
    const id = agent === "codex" ? sessionId.replace(/^codex:/, "") : sessionId;
    parts.push(agent === "codex" ? "resume" : "--resume", shellQuote(id));
  }
  if (prompt) parts.push("--", shellQuote(prompt));
  return parts.join(" ");
}
