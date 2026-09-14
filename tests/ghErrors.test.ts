import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failure: undefined as unknown }));
vi.mock("../src/main/settings.js", async () => {
  const { defaultSettings } = await import("../src/shared/settings.js");
  return { getSettings: () => defaultSettings };
});
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(() => {}, { [promisify.custom]: async () => { throw state.failure; } }) };
});
const { graphql } = await import("../src/main/github.js");

const ghFailure = (stderr: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Command failed: gh api graphql -f query=query { viewer { login } }\n${stderr}`), { stderr, ...extra });

describe("gh failures on the settings page", () => {
  it("names the missing scope and the command that grants it", async () => {
    const scopes = "gh: Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes.";
    state.failure = ghFailure(`${scopes} ${scopes}`);
    await expect(graphql("query { viewer { login } }", {})).rejects.toThrow("Your gh login is missing the read:project scope. Run: gh auth refresh -s read:project");
  });
  it("says when gh is not installed", async () => {
    state.failure = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    await expect(graphql("query", {})).rejects.toThrow("The GitHub CLI (gh) is not installed.");
  });
  it("says when gh is not logged in", async () => {
    state.failure = ghFailure("To get started with GitHub CLI, please run:  gh auth login");
    await expect(graphql("query", {})).rejects.toThrow("Not logged in to GitHub. Run: gh auth login");
  });
  it("keeps only the first line of anything else, without the command echo", async () => {
    state.failure = ghFailure("gh: Could not resolve to a ProjectV2 with the number 2.\nmore detail");
    await expect(graphql("query", {})).rejects.toThrow("Could not resolve to a ProjectV2 with the number 2.");
  });
});
