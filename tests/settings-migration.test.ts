import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ stored: {} as Record<string, unknown> }));
vi.mock("../src/main/db.js", () => ({
  kvGet: () => state.stored,
  kvSet: (_key: string, value: unknown) => (state.stored = value as Record<string, unknown>),
}));

const { getSettings, updateSettings } = await import("../src/main/settings.js");
const { workspaceOf } = await import("../src/shared/settings.js");

describe("review source migration", () => {
  it("reads a saved review column as the board source", () => {
    state.stored = { jira: { reviewColumns: ["Review"] } };
    expect(getSettings().reviewSource).toBe("board");
    expect(getSettings().board.reviewColumns).toEqual(["Review"]);
  });

  it("leaves a profile that never picked a column on GitHub", () => {
    state.stored = { board: { reviewColumns: [] } };
    expect(getSettings().reviewSource).toBe("github");
  });

  it("keeps the source the user chose", () => {
    state.stored = { reviewSource: "github", board: { reviewColumns: ["Review"] } };
    expect(getSettings().reviewSource).toBe("github");
  });
});

describe("workspaces", () => {
  it("turns a profile saved before workspaces into one, named after its owner", () => {
    state.stored = { github: { owner: "acme" }, linear: { apiKey: "k", teamKey: "ENG" }, theme: "light" };
    const settings = getSettings();
    expect(settings.workspaces).toHaveLength(1);
    expect(settings.workspaces[0]).toMatchObject({ id: "default", name: "acme", github: { owner: "acme" }, linear: { apiKey: "k", teamKey: "ENG" } });
    expect(settings.activeWorkspace).toBe("default");
    expect(settings.github.owner).toBe("acme");
    expect(settings.theme).toBe("light");
  });

  it("mirrors the active workspace and writes its fields back into it", () => {
    state.stored = {
      workspaces: [{ id: "a", name: "A", github: { owner: "a-org" } }, { id: "b", name: "B", github: { owner: "b-org" } }],
      activeWorkspace: "b",
    };
    expect(getSettings().github.owner).toBe("b-org");
    updateSettings({ github: { owner: "b-corp" }, theme: "light" });
    const stored = state.stored as { workspaces: { id: string; github: { owner: string } }[]; theme: string; github?: unknown };
    expect(stored.workspaces.map((w) => w.github.owner)).toEqual(["a-org", "b-corp"]);
    expect(stored.theme).toBe("light");
    expect(stored.github).toBeUndefined();
  });

  it("switches, and falls back to the first workspace when the active one is removed", () => {
    state.stored = { workspaces: [{ id: "a", name: "A", github: { owner: "a-org" } }, { id: "b", name: "B", github: { owner: "b-org" } }], activeWorkspace: "a" };
    expect(updateSettings({ activeWorkspace: "b" }).github.owner).toBe("b-org");
    const settings = updateSettings({ workspaces: getSettings().workspaces.filter((w) => w.id !== "b") });
    expect(settings.activeWorkspace).toBe("a");
    expect(settings.github.owner).toBe("a-org");
  });
});

describe("which workspace a terminal or session belongs to", () => {
  const workspaces = [{ id: "default" }, { id: "saba" }];
  it("is the one it was stamped with", () => expect(workspaceOf("saba", workspaces)).toBe("saba"));
  it("is the migrated workspace when it predates workspaces", () => expect(workspaceOf(null, workspaces)).toBe("default"));
  it("is the migrated workspace when its own was removed", () => expect(workspaceOf("gone", workspaces)).toBe("default"));
  it("is the first workspace once the migrated one is gone", () => expect(workspaceOf(undefined, [{ id: "saba" }, { id: "convozy" }])).toBe("saba"));
});
