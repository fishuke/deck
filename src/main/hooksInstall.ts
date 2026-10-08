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
description: Draw for the user inside Deck. Use whenever you plan, propose an approach, explain a flow, an architecture, a data model, a sequence or a set of options, or want to show the user you understood them; the user is a visual thinker. Posts a mermaid chart, svg, html page, markdown or code to the Canvas panel next to the terminal. Only works inside a deck terminal ($DECK_TERM_ID set).
---

The person reading you thinks in pictures. A Canvas panel sits next to this
terminal, and every drawing you post appears there at once. Draw first, then
write your text.

When to draw: before you present a plan (in plan mode too), when you explain
how something works or fits together, when you compare options, when you want
to check that you understood the person. Redraw when they correct you; frames
stack and they can step back through earlier ones.

Formats, best first:
- \`mermaid\` for flowcharts, sequences, state machines, timelines, mind maps.
  Fast to write and renders well.
- \`svg\` for a designed diagram or illustration you lay out yourself: rounded
  nodes, a palette, a stickman, icons. A 16:9 viewBox around 960x540 fits;
  text 14px or larger; colors that read on dark and light.
- \`html\` for anything richer: a mockup, a page, an interactive demo. A full
  document; it runs sandboxed in the panel.
- \`markdown\` for tables and checklists, \`code\` for a snippet (add \`language\`),
  \`ascii\` for a tiny sketch, \`link\` to show a URL.

How to post: write the drawing to a temp file, then send it with the format
and a short title. The body is the drawing itself, so nothing needs escaping.

\`\`\`bash
cat > /tmp/deck-canvas.mmd <<'DRAWING'
flowchart LR
  A[Idea] --> B[Define] --> C[Design] --> D[Build]
  D --> E[Test] --> F[Release] --> G[Observe] --> A
DRAWING
curl -s -m 3 -X POST "http://127.0.0.1:\${DECK_PORT:-${DEFAULT_SERVER_PORT}}/api/canvas?format=mermaid" \\
  -H "x-deck-term: $DECK_TERM_ID" -H "x-deck-title: How software gets made" \\
  --data-binary @/tmp/deck-canvas.mmd >/dev/null || true
\`\`\`

\`format\` is one of mermaid, svg, html, markdown, code, ascii, link. Optional
headers: \`x-deck-language\` for code, \`x-deck-alt\` with one line saying what
the drawing shows. \`curl -s -X DELETE .../api/canvas -H "x-deck-term: $DECK_TERM_ID"\`
clears the canvas.

Skip this silently if $DECK_TERM_ID is empty. Nothing is off limits: a
stickman, a mock website, a timeline, a map of the codebase, a before/after.
If a picture would help, make it, and make it look good.
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
