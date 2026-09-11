import type { ReactNode } from "react";
import type { Agent } from "../../../shared/agents.js";
import type { AgentSession } from "../../../main/sessions.js";
import { Icon } from "../board/icons.js";

export const statusLabels: Record<AgentSession["status"], string> = {
  working: "Working", needs_input: "Needs input", needs_review: "Needs review", idle: "Ready", ended: "Ended",
};
/** Colour per status, shared by the sidebar, the board and the agent page. */
export const statusTones: Record<AgentSession["status"], { text: string }> = {
  working: { text: "text-accent" },
  needs_input: { text: "text-orange" },
  needs_review: { text: "text-blue" },
  idle: { text: "text-green" },
  ended: { text: "text-dim" },
};

// Drawn rather than set as text: the geometric characters (◐ ● ◆ ○) differ in
// size by up to twice at one font size, so they never look like a set. These
// share a 16-unit grid and a ~11-unit width, and the working ring spins about
// its own centre.
const marks: Record<AgentSession["status"], ReactNode> = {
  working: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="25 35" />,
  needs_input: <circle cx="8" cy="8" r="5.5" fill="currentColor" />,
  needs_review: <path d="M8 2l6 6-6 6-6-6z" fill="currentColor" />,
  idle: <circle cx="8" cy="8" r="4.75" fill="none" stroke="currentColor" strokeWidth="2.5" />,
  ended: <path d="M3.5 8.5l3.5 3.5 5.5-6.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
};

/** The status mark on its own, for lists that have no avatar to badge. */
export function StatusMark({ status, size = 11 }: { status?: AgentSession["status"]; size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden
    className={status === "working" ? "animate-spin" : undefined}>
    {status ? marks[status] : <circle cx="8" cy="8" r="5.5" fill="currentColor" />}
  </svg>;
}

/** Agent avatar with its status badge. `color` marks a tab with no agent
 *  session, using the colour that tab's program set over OSC 6. */
export function SessionIcon({ agent, status, color }: { agent?: Agent; status?: AgentSession["status"]; color?: string }) {
  const tone = status ? statusTones[status] : undefined;
  return <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card2 text-soft">
    {agent === "codex" ? <span className="text-lg leading-none">◎</span> : <Icon name={agent === "claude" ? "sparkle" : "terminal"} size={16} />}
    {(tone || color) && <span aria-hidden title={status ? statusLabels[status] : undefined} style={color ? { color } : undefined}
      className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-panel ${tone?.text ?? ""}`}>
      <StatusMark status={status} size={10} />
    </span>}
  </span>;
}
