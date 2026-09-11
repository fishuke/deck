import type { Agent } from "../../../shared/agents.js";
import type { AgentSession } from "../../../main/sessions.js";
import { Icon } from "../board/icons.js";

export const statusLabels: Record<AgentSession["status"], string> = {
  working: "Working", needs_input: "Needs input", needs_review: "Needs review", idle: "Ready", ended: "Ended",
};
/** Glyph and colour per status, shared by the sidebar, the board and the agent page. */
export const statusTones: Record<AgentSession["status"], { text: string; glyph: string }> = {
  working: { text: "text-accent", glyph: "◐" },
  needs_input: { text: "text-orange", glyph: "●" },
  needs_review: { text: "text-blue", glyph: "◆" },
  idle: { text: "text-green", glyph: "○" },
  ended: { text: "text-dim", glyph: "✓" },
};

/** Agent avatar with its status badge. `color` marks a tab with no agent
 *  session, using the colour that tab's program set over OSC 6. */
export function SessionIcon({ agent, status, color }: { agent?: Agent; status?: AgentSession["status"]; color?: string }) {
  const tone = status ? statusTones[status] : undefined;
  return <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card2 text-soft">
    {agent === "codex" ? <span className="text-lg leading-none">◎</span> : <Icon name={agent === "claude" ? "sparkle" : "terminal"} size={16} />}
    {(tone || color) && <span aria-hidden title={status ? statusLabels[status] : undefined} style={color ? { color } : undefined}
      className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-panel text-[7px] leading-none ${tone?.text ?? ""} ${status === "working" ? "animate-spin" : ""}`}>
      {tone?.glyph ?? "●"}
    </span>}
  </span>;
}
