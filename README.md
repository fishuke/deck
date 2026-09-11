<p align="center">
  <img src="resources/icon.png" width="96" alt="Deck icon">
</p>

<h1 align="center">Deck</h1>

<p align="center">
  <strong>An AI-native software delivery workflow, wrapped around the tracker you already use.</strong><br>
  Jira, Linear or GitHub Projects beside Claude Code, Codex and GitHub, on one Kanban board. Pick a card, code it with an agent, review the PR, ship it. One screen.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-early%20preview-orange">
</p>

<p align="center">
  <img src="docs/media/deck.gif" width="900" alt="Deck tour: summon the panel with ⌥ Space, Claude Code and Codex sessions, the issue board, the pull request review queue">
</p>

<p align="center"><sub>Screens show fixture data only. Source in <a href="docs/media/motion">docs/media/motion</a>, rendered with <code>npm run demo:gif</code>.</sub></p>

---

## Why Deck

Most engineering teams run their delivery from an issue tracker, whether that is Jira, Linear or GitHub Projects. Coding agents have made the writing part fast, but the loop around it is still slow: find the ticket in the tracker, open a terminal for Claude Code or Codex, switch to GitHub to review, go back to the tracker to move the card. Every hop costs the thread you were holding, and none of these tools know about each other.

Deck's answer is a Kanban board that is also your terminal, your review queue and your orchestrator:

- **Bring your own tracker.** Jira, Linear or a GitHub Project, picked in Settings. Each one is an adapter behind the same board, so every feature below works the same whichever you connect.
- **Start from the card.** Every issue on the board can launch a Claude Code or Codex session bound to that ticket, in the right repository. The agent's live status shows on the card.
- **Move the card, move the ticket.** Drag between columns and Deck fires the matching transition in your tracker. The board syncs in the background, so a slow tracker stays out of your way.
- **Review where you code.** Pull requests waiting on you arrive as a queue with the diff, checks and linked ticket. Approve and the next one loads.
- **Orchestrate the whole loop.** Ask Deck what needs attention and it can start agents, put one on a broken PR, or file the next issue. Every answer sees your sessions, your PR inbox and your board.
- **Search everything you ever asked.** One palette over live sessions and the full chat history of Claude Code and Codex, so the answer from last week is a ⌘K away.

Summon it with **⌥ Space**. Code, review and orchestrate without leaving the screen.

## Features

### Terminal

- **Agent sessions**: launch or resume Claude Code and Codex, see live status in the sidebar, and search your local conversation history across both.
- **Vertical tabs** with search, rename, attention filters, Git status and keyboard navigation. A single "Continue your last session" suggestion appears for activity within the last 15 minutes; older sessions stay searchable.
- **Splits and panes**: resizable nested splits, find in terminal, export, multiline input, and a local file explorer with text editing and Markdown preview.
- **Zen and Presentation** on every page, WebStorm style. Both go fullscreen and hide the chrome; Presentation also enlarges the terminal font and zooms the other pages by the same ratio.

### Board <kbd>⌘⌥2</kbd>

Your board as a Kanban view inside Deck, mirroring Jira, Linear or a GitHub Project. Cards carry the agents that have touched them; opening a card shows the issue, its sessions and its pull requests, and starts a new Claude Code or Codex session on it. Dragging a card to another column fires the matching transition in the tracker, optimistically, with the sync catching up in the background.

### Agent page <kbd>⌘⌥3</kbd>

Deck's orchestrator, front and centre. Every question gets the live sessions, your PR inbox and the synced board as context. Through Deck's own MCP tools it can:

- start Claude or Codex agents in Deck terminals, answer or steer running ones, and read their transcripts
- put an agent on a broken PR
- search the tracker's backlog and create issues, only after you agree

The rail lists what needs you and every live session. The sidebar badge counts it. Make it the start page from its header or **Settings → General**.

### Reviews page <kbd>⌘⌥4</kbd>

Every pull request waiting on your review, one at a time like a mail client. Each shows the linked issue, the overview, the diff and a pinned agent helper (<kbd>a</kbd>). Approve or request changes and the queue moves on. <kbd>n</kbd> / <kbd>p</kbd> step through without leaving. Review threads collapse to one line like GitHub's, and resolved or outdated threads start collapsed.

### Auto-fix

Opt-in, off by default. Once enabled in **Settings → General**, Deck starts a fix agent in the repo's local checkout when CI fails or a PR of yours gets merge conflicts, once per push. The agent stops with the diff and waits for your approval before pushing unless you let it push unattended.

### Themes and plugins

Five built-in themes, live custom JSON themes, and local plugins that contribute themes, commands, agent prompts and Markdown panels. See the [extension guide](docs/extensions.md) and the [starter plugin](examples/plugins/workspace-kit).

## Install

Download the latest `.dmg` for your Mac (Apple Silicon or Intel) from the [releases page](https://github.com/fishuke/deck/releases) and drag Deck into Applications.

The builds are not notarized with Apple yet, so macOS will refuse to open the app the first time. Clear the quarantine flag once:

```sh
xattr -cr /Applications/Deck.app
```

**First run.** Deck opens on a short setup for the thing it is built around: the summon hotkey. Pick the keystroke, choose whether it drops down as a quake panel over the top of the screen, and press it once to see it work. Skipping is fine, and **Settings → General → run setup again** brings it back.

## Run from source

```sh
git clone https://github.com/fishuke/deck.git
cd deck
npm install
npm run dev
```

**Requirements.** Node 22 or newer.

Install and authenticate [`claude`](https://docs.anthropic.com/en/docs/claude-code) and/or [`codex`](https://github.com/openai/codex) separately. Pick the default agent in **Settings → General**; new-session menus and PR review screens let you choose either.

**Live status hooks.** Use the sidebar's live-status controls to install hooks for each provider. For Codex, trust Deck's installed hooks in Codex's `/hooks` interface. Deck preserves existing hooks and does not bypass agent permissions. The hook server accepts local connections only.

**History.** Indexed from `~/.claude/projects`, plus `$CODEX_HOME/sessions` and `archived_sessions` (default `~/.codex`). Codex subagent transcripts and internal environment messages are excluded from results.

**GitHub and the board.** Pull request tools use the `gh` CLI. The board mirrors Jira, Linear or a GitHub Project (pick one in Settings) and syncs in the background once configured. Each tracker is an adapter behind the same board interface (`src/main/board/`).

## Shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>⌥ Space</kbd> | Summon or hide Deck |
| <kbd>⌘K</kbd> | Search sessions, history, commands, settings, themes and repositories |
| <kbd>⌘T</kbd> / <kbd>⌘W</kbd> | New / close terminal |
| <kbd>⌘⇧T</kbd> | Reopen the last closed tab |
| <kbd>⌘⇧N</kbd> | New tab running the default agent |
| <kbd>⌘N</kbd> | New window |
| <kbd>⌘1</kbd>–<kbd>⌘9</kbd> | Switch terminal |
| <kbd>⌘B</kbd> | Toggle sidebar |
| <kbd>⌘⌥1</kbd> <kbd>⌘⌥2</kbd> <kbd>⌘⌥3</kbd> <kbd>⌘⌥4</kbd> | Terminal / Board / Agent / Reviews |
| <kbd>⌘D</kbd> / <kbd>⌘⇧D</kbd> | Split right / down |
| <kbd>⌘F</kbd> | Find in terminal |
| <kbd>⌘J</kbd> | Toggle multiline input |
| <kbd>⌘⇧Enter</kbd> | Toggle Zen view |
| <kbd>⌘⇧P</kbd> | Toggle Presentation view |
| <kbd>Esc</kbd> | Exit Zen / Presentation from the terminal |

Drag pane dividers to resize; arrow keys resize a focused divider and double-click resets it. Presentation controls adjust text size and switch sessions, and exiting restores your split layout.

## Development

```sh
npm run typecheck   # both tsconfig projects
npm test            # unit tests on Electron's Node runtime
npm run test:ui     # Electron smoke test with fixture sessions, screenshots in artifacts/ui
npm run test:pty    # native PTY input/output, replay, metadata and termination
npm run demo:gif    # render docs/media/deck.gif and deck.mp4 from docs/media/motion (needs ffmpeg)
npm run install:app # build and install /Applications/Deck.app from this checkout
```

**Using Deck while working on it.** `npm run dev` runs as its own channel, **Deck Dev**: separate name, dock tile, database, settings and PTY socket, and it listens on port 47801 instead of 47800. So the Deck you use all day can stay open while dev restarts on every save. Its settings start from the defaults, so give it its own summon hotkey. Agent hooks are installed once globally and carry the port of the terminal they run in, so each channel sees its own sessions.

Tests use Electron's Node runtime to match the native SQLite ABI. The UI smoke test opens an isolated window with fixture sessions and never launches paid agents or touches your real sessions. Run it in a desktop environment.

Stack: Electron, React, Tailwind, xterm.js, SQLite, Hono.

## Roadmap

Deck is evolving toward an everyday terminal replacement. It implements the local terminal UI and agent workflows above. It does not include cloud collaboration or compatibility with other terminals' extension formats.

## Contributing

Issues and pull requests are welcome. Keep changes small and focused, run the checks in [Development](#development), and add a test alongside any new behaviour. Extension authors should start with the [extension guide](docs/extensions.md).

## License

[MIT](LICENSE)
