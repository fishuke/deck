import type { Agent } from "../shared/agents.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SERVER_PORT } from "./port.js";

// Merges deck's session-tracking hooks into ~/.claude/settings.json, so every
// Claude Code session on the machine reports lifecycle events to deck. The
// curl times out fast and swallows failure: a dead deck never blocks Claude.

const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Notification",
  "PostToolUse",
  "Stop",
  "SessionEnd",
];

const MARKER = "/api/hook";

// One settings.json serves every deck channel, so the port comes from the
// terminal rather than from install time: each terminal carries the port of
// the deck that spawned it, and a shell outside deck falls back to the
// installed app's.
function hookCommand(agent: Agent): string {
  return `curl -s -m 3 -X POST "http://127.0.0.1:\${DECK_PORT:-${DEFAULT_SERVER_PORT}}/api/hook" -H 'x-deck-term: '"$DECK_TERM_ID" -H 'x-deck-agent: ${agent}' -H 'Content-Type: application/json' --data-binary @- >/dev/null || true`;
}

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

// A model-invoked skill: Claude triggers it whenever it pauses to ask the
// user to verify changes before committing/pushing, and it reports the
// decision summary to deck so the tab flips to "needs review".
const SKILL = `---
name: deck-review
description: Use whenever you pause to ask the user to review or verify changes before committing, pushing, or opening a PR. Marks the deck terminal tab as "needs review" and shows your decision summary next to the diff. Only works inside a deck terminal ($DECK_TERM_ID set).
---

You are about to ask the user to verify your changes. Before writing that
message:

1. Compose a short markdown summary of the decisions and choices you made —
   highlight questionable ones: assumptions, trade-offs, anything with a
   reasonable alternative approach.
2. Write the summary to a temp file and send it to deck:

   \`\`\`bash
   cat > /tmp/deck-review-note.md <<'NOTE'
   <your summary>
   NOTE
   curl -s -m 3 -X POST "http://127.0.0.1:\${DECK_PORT:-${DEFAULT_SERVER_PORT}}/api/review" -H "x-deck-term: $DECK_TERM_ID" --data-binary @/tmp/deck-review-note.md >/dev/null || true
   \`\`\`

   Skip this silently if $DECK_TERM_ID is empty.
3. Then present the same summary to the user and ask for verification. Do
   not commit, push, or open the PR until the user explicitly confirms.
`;

function installReviewSkill(agent: Agent): void {
  const dir = path.join(agentHome(agent), "skills", "deck-review");
  const file = path.join(dir, "SKILL.md");
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === SKILL) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, SKILL);
}

const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop", "Interrupt", "SessionEnd"];

function agentHome(agent: Agent): string {
  return agent === "codex" ? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex") : path.join(os.homedir(), ".claude");
}

function hooksPath(agent: Agent): string {
  return path.join(agentHome(agent), agent === "codex" ? "hooks.json" : "settings.json");
}

export function installHooks(agent: Agent = "claude"): { installed: boolean; path: string } {
  installReviewSkill(agent);
  const file = hooksPath(agent);
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const hooks = settings.hooks ?? {};
  let changed = false;
  for (const event of agent === "codex" ? CODEX_EVENTS : CLAUDE_EVENTS) {
    const groups: HookGroup[] = hooks[event] ?? [];
    const command = hookCommand(agent);
    // An older deck baked its port into the URL; rewrite those commands
    // instead of leaving a second hook pointing at one channel.
    const installed = groups.flatMap((group) => group.hooks ?? []).filter((hook) => hook.command?.includes(MARKER));
    if (installed.length) {
      for (const hook of installed) {
        if (hook.command === command) continue;
        hook.command = command;
        changed = true;
      }
    } else {
      groups.push({ hooks: [{ type: "command", command }] });
      hooks[event] = groups;
      changed = true;
    }
  }
  if (changed) {
    settings.hooks = hooks;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return { installed: changed, path: file };
}

export function hooksInstalled(agent: Agent = "claude"): boolean {
  const file = hooksPath(agent);
  return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(MARKER);
}
