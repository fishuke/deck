import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ stored: {} as Record<string, unknown> }));
vi.mock("../src/main/db.js", () => ({
  kvGet: () => state.stored,
  kvSet: (_key: string, value: unknown) => (state.stored = value as Record<string, unknown>),
}));

const { getSettings } = await import("../src/main/settings.js");

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
