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

// A second model-invoked skill: whenever Claude plans or explains, it posts
// a drawing to the terminal's canvas panel instead of describing it in text.
export const CANVAS_SKILL = `---
name: deck-canvas
description: Show things on the Canvas panel next to the Deck terminal instead of only in chat. Use whenever you plan, explain a flow, an architecture or a set of options, answer a question with structure (steps, a comparison, a summary, a table), keep a todo list or a progress list for the user, or want to show you understood them; the user is a visual thinker. Posts mermaid, svg, html, markdown (with tickable todo items), code or a link. Only works inside a deck terminal ($DECK_TERM_ID set).
---

The person reading you thinks in pictures and lists. A Canvas panel sits
next to this terminal, and whatever you post appears there at once. Put the
substance on the canvas, keep the chat text short and point at it.

The canvas is a set of tabs, one per title. Posting a title that is already
there replaces that tab, so a thing that evolves (the status, the plan, the
todo list) keeps one tab and never piles up. Use a new title only for a new
thing. Twelve tabs at most; the one touched longest ago goes.

What goes on the canvas:
- One short status tab titled \`Now\`: what we are working on, what is done,
  the next steps (a few lines, task items for the steps). Post it when a
  piece of work starts and post it again whenever the plan moves, so the
  person always has the picture of where things stand. The panel brings the
  tab touched last to the front.
- A plan before you present it (in plan mode too), a flow, an architecture,
  a data model, a sequence, options side by side.
- An answer that has structure: steps, a comparison table, a summary, a
  checklist, key facts. Chat gets the one-line takeaway.
- A todo or progress list for the work at hand. Use markdown task items
  (\`- [ ] item\`, \`- [x] done\`). The person can tick items in the panel; tick
  them yourself as you finish by posting the list again under its title.
- Anything that shows you understood them. Redraw under the same title when
  they correct you.

Formats:
- \`markdown\` for answers, lists, todos, tables, summaries.
- \`mermaid\` for flowcharts, sequences, state machines, timelines, mind maps.
  Prefer top-to-bottom (\`flowchart TB\`) in this narrow panel.
- \`svg\` for a designed diagram or illustration you lay out yourself: rounded
  nodes, a palette, a stickman, icons. Portrait or square fits the panel
  better than 16:9; text 14px or larger; colors that read on dark and light.
- \`html\` for anything richer: a mockup, a page, an interactive demo. A full
  document; it runs sandboxed in the panel.
- \`code\` for a snippet (add \`x-deck-language\`), \`ascii\` for a tiny sketch,
  \`link\` to show a URL.

How to post: write the content to a temp file, then send it with the format
and a short title. The body is the content itself, so nothing needs escaping.

\`\`\`bash
cat > /tmp/deck-canvas.md <<'CANVAS'
## Add dark mode
- [ ] Theme tokens for every color
- [ ] Toggle in Settings
- [ ] Remember the choice
CANVAS
curl -s -m 3 -X POST "http://127.0.0.1:\${DECK_PORT:-${DEFAULT_SERVER_PORT}}/api/canvas?format=markdown" \\
  -H "x-deck-term: $DECK_TERM_ID" -H "x-deck-title: Dark mode plan" \\
  --data-binary @/tmp/deck-canvas.md
\`\`\`

Post the same title again to update that tab. (The reply also carries the
tab's \`id\`; \`PUT .../api/canvas/<id>\` with new content does the same.)

To see what the person ticked or what is on the canvas:
\`curl -s "http://127.0.0.1:\${DECK_PORT:-${DEFAULT_SERVER_PORT}}/api/canvas" -H "x-deck-term: $DECK_TERM_ID"\`.
\`curl -s -X DELETE .../api/canvas -H "x-deck-term: $DECK_TERM_ID"\` clears it.
Optional headers: \`x-deck-language\` for code, \`x-deck-alt\` with one line
saying what a drawing shows.

Skip this silently if $DECK_TERM_ID is empty. Nothing is off limits: a
stickman, a mock website, a timeline, a map of the codebase, a before/after.
If a picture or a list would help, make it, and make it look good.
`;

export const SKILLS: Record<string, string> = { "deck-review": SKILL, "deck-canvas": CANVAS_SKILL };

function installSkills(agent: Agent): void {
  for (const [name, text] of Object.entries(SKILLS)) {
    const dir = path.join(agentHome(agent), "skills", name);
    const file = path.join(dir, "SKILL.md");
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text);
  }
}

const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop", "Interrupt", "SessionEnd"];

function agentHome(agent: Agent): string {
  return agent === "codex" ? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex") : path.join(os.homedir(), ".claude");
}

function hooksPath(agent: Agent): string {
  return path.join(agentHome(agent), agent === "codex" ? "hooks.json" : "settings.json");
}

export function installHooks(agent: Agent = "claude"): { installed: boolean; path: string } {
  installSkills(agent);
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
