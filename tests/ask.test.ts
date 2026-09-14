import type { BoardCache } from "../src/main/board/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  board: undefined as BoardCache | undefined,
  configured: true,
  launches: [] as { bin: string; args: string[] }[],
  inbox: undefined as import("../src/main/prInbox.js").PrInbox | undefined,
  toolCall: false,
}));
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/main/db.js", () => ({
  kvGet: (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : undefined),
  kvSet: (key: string, value: unknown) => kv.set(key, JSON.stringify(value)),
}));
vi.mock("../src/main/board/board.js", () => ({ getBoardCache: () => state.board, boardConfigured: () => state.configured }));
vi.mock("../src/main/settings.js", async () => {
  const { defaultSettings } = await import("../src/shared/settings.js");
  return { getSettings: () => ({ ...defaultSettings, jira: { ...defaultSettings.jira, baseUrl: "https://jira.example.test", apiToken: "DO-NOT-SEND-THIS-TOKEN", email: "private@example.test" } }) };
});
vi.mock("../src/main/sessions.js", () => ({ listSessions: () => [], markInternalSession: vi.fn() }));
vi.mock("../src/main/indexer.js", () => ({ lastMessages: () => [] }));
vi.mock("../src/main/autofix.js", () => ({ runningFixes: () => [{ repo: "acme/api", number: 7, problem: "ci_failed", termId: "t1", startedAt: 0 }] }));
vi.mock("../src/main/orchestrator.js", () => ({ boardLabel: () => "Jira", boardProjects: () => ["APP"], toolNames: () => ["list_sessions", "start_agent"] }));
vi.mock("../src/main/server.js", () => ({ MCP_URL: "http://127.0.0.1:47800/api/mcp" }));
vi.mock("../src/main/prInbox.js", async () => {
  const { attentionReasons, prsAwaitingReview } = await import("../src/main/prInbox.js");
  return { attentionReasons, prsAwaitingReview, getPrInbox: () => state.inbox };
});
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return {
    execFile: Object.assign(() => {}, { [promisify.custom]: async (_shell: string, args: string[]) => ({ stdout: args[1].includes("codex") ? "/mock/codex" : "/mock/claude" }) }),
    spawn: (bin: string, args: string[]) => {
      state.launches.push({ bin, args });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      queueMicrotask(() => {
        if (state.toolCall) {
          const tool = bin.endsWith("codex") ? { type: "item.started", item: { type: "mcp_tool_call", server: "deck", tool: "start_agent", arguments: { repo: "api" } } }
            : { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__deck__start_agent", input: { repo: "api" } }] } };
          child.stdout.write(JSON.stringify(tool) + "\n");
        }
        const event = bin.endsWith("codex") ? { type: "item.completed", item: { type: "agent_message", text: "Fixture answer" } }
          : { type: "stream_event", event: { delta: { type: "text_delta", text: "Fixture answer" } } };
        child.stdout.write(JSON.stringify(event) + "\n");
        child.emit("close", 0);
      });
      return child;
    },
  };
});
const { askDeck, boardSnapshot, inboxSnapshot, resetAsk } = await import("../src/main/ask.js");

const pr = (number: number, extra: Partial<import("../src/main/prInbox.js").InboxPr> = {}) => ({
  repo: "acme/api", number, title: `PR ${number}`, url: `https://github.com/acme/api/pull/${number}`, author: "me", isDraft: false,
  updatedAt: "2026-09-07T10:00:00Z", headRefName: `feature-${number}`, baseRefName: "main", reviewDecision: null, mergeable: "MERGEABLE", checks: "SUCCESS", ...extra,
});

beforeEach(() => {
  resetAsk();
  state.launches = [];
  state.configured = true;
  state.toolCall = false;
  state.inbox = { viewer: "me", at: Date.parse("2026-09-07T14:00:00Z"), mine: [pr(7, { checks: "FAILURE" }), pr(8)], reviewRequested: [pr(9, { author: "teammate" })] };
  state.board = {
    provider: "jira", boardName: "Engineering", at: Date.parse("2026-09-07T14:00:00Z"), myAccountId: "me",
    columns: [{ name: "In review", statusIds: ["qa", "review"] }],
    issues: [
      { id: "1", key: "APP-42", summary: "Fix login expiry", statusId: "qa", statusName: "Ready for QA", assignee: "Me", assigneeId: "me", updated: "2026-09-07", url: "https://jira.example.test/browse/APP-42", localMove: true },
      { id: "2", key: "APP-43", summary: "Improve keyboard navigation", statusId: "review", statusName: "Code review", assignee: "Teammate", assigneeId: "other", updated: "2026-09-07", url: "https://jira.example.test/browse/APP-43" },
    ],
  };
});

describe("Ask Deck board context", () => {
  it.each(["claude", "codex"] as const)("gives %s board data when no agents are running, refreshing it for each turn", async (agent) => {
    expect(await askDeck("Which of my tasks are in review?", () => {}, agent)).toMatchObject({ ok: true, text: "Fixture answer" });
    const prompt = state.launches[0].args.join("\n");
    expect(prompt).toContain("No agent sessions are running");
    expect(prompt).toContain('"key":"APP-42"');
    expect(prompt).toContain('"column":"In review"');
    expect(prompt).toContain('"assignedToMe":true');
    expect(prompt).toContain('"localOnly":true');
    expect(prompt).toContain("2026-09-07T14:00:00.000Z");
    expect(prompt).not.toContain("DO-NOT-SEND-THIS-TOKEN");
    expect(prompt).not.toContain("private@example.test");
    state.board!.issues[0].summary = "Updated task title";
    await askDeck("And now?", () => {}, agent);
    expect(state.launches[1].args.join("\n")).toContain("Updated task title");
  });
  it.each(["claude", "codex"] as const)("hands %s deck's MCP tools and reports the tools it calls", async (agent) => {
    state.toolCall = true;
    const events: import("../src/main/ask.js").AskEvent[] = [];
    await askDeck("Start an agent on the api repo", (e) => events.push(e), agent);
    const args = state.launches[0].args;
    if (agent === "claude") {
      expect(args[args.indexOf("--mcp-config") + 1]).toContain("http://127.0.0.1:47800/api/mcp");
      expect(args[args.indexOf("--allowedTools") + 1]).toContain("mcp__deck__start_agent");
    } else {
      expect(args).toContain('mcp_servers.deck.url="http://127.0.0.1:47800/api/mcp"');
    }
    expect(events[0]).toEqual({ type: "tool", name: "start_agent", input: '{"repo":"api"}' });
    expect(events.at(-1)).toEqual({ type: "text", text: "Fixture answer" });
  });
  it("resumes the same claude conversation after the module is reloaded", async () => {
    await askDeck("First question", () => {}, "claude");
    const started = state.launches[0].args;
    const id = started[started.indexOf("--session-id") + 1];
    vi.resetModules();
    const reloaded = await import("../src/main/ask.js");
    await reloaded.askDeck("Second question", () => {}, "claude");
    expect(state.launches[1].args).toContain("--resume");
    expect(state.launches[1].args).toContain(id);
    reloaded.resetAsk();
    await reloaded.askDeck("Fresh start", () => {}, "claude");
    expect(state.launches[2].args).toContain("--session-id");
    expect(state.launches[2].args).not.toContain(id);
  });
  it("includes the PR inbox with attention reasons and running fixes", async () => {
    await askDeck("Any PR of mine needing attention?", () => {}, "claude");
    const prompt = state.launches[0].args[1];
    expect(prompt).toContain("Board tracker: Jira");
    expect(prompt).toContain("Projects on the board: APP");
    const inbox = JSON.parse(inboxSnapshot());
    expect(inbox.mine[0]).toMatchObject({ number: 7, needsAttention: ["ci_failed"], fixInProgress: ["ci_failed"] });
    expect(inbox.mine[1]).toMatchObject({ number: 8, needsAttention: [], fixInProgress: [] });
    expect(inbox.reviewRequested[0]).toMatchObject({ number: 9, author: "teammate" });
    expect(prompt).toContain('"needsAttention":["ci_failed"]');
    state.inbox = undefined;
    expect(inboxSnapshot()).toContain("No PR data yet");
  });
  it("distinguishes missing setup, missing sync and a successfully synced empty board", () => {
    state.board = undefined;
    expect(boardSnapshot()).toContain("no board snapshot yet");
    state.configured = false;
    expect(boardSnapshot()).toContain("not configured");
    state.board = { provider: "jira", boardName: "Empty board", columns: [], issues: [], at: Date.now() };
    expect(JSON.parse(boardSnapshot())).toMatchObject({ board: "Empty board", ownershipKnown: false, issues: [] });
  });
  it("keeps teammate ownership distinct and handles caches without a current-user identity", () => {
    expect(JSON.parse(boardSnapshot()).issues[1].assignedToMe).toBe(false);
    delete state.board!.myAccountId;
    expect(JSON.parse(boardSnapshot()).issues[0].assignedToMe).toBeNull();
  });
});
