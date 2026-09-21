import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/github.js", () => ({ prSummary: async () => null }));
vi.mock("../src/main/indexer.js", () => ({ transcriptPath: () => undefined }));
vi.mock("../src/main/sessions.js", () => ({ getSession: () => undefined }));
const { createdPrs } = await import("../src/main/sessionPrs.js");

const line = (row: unknown) => JSON.stringify(row);
const claudeCall = (id: string, command: string) =>
  line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const claudeResult = (id: string, content: unknown) =>
  line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } });
const codexCall = (call_id: string, cmd: string) =>
  line({ type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd }), call_id } });
const codexOutput = (call_id: string, output: string) =>
  line({ type: "response_item", payload: { type: "function_call_output", call_id, output } });

describe("createdPrs", () => {
  it("pairs a Claude gh pr create with the output that printed the new PR", () => {
    const prs = createdPrs([
      claudeCall("t1", "git push -u origin INI-1 && gh pr create --title 'INI-1: fix'"),
      claudeResult("t1", "remote: https://github.com/acme/api/pull/new/INI-1\nok created #12 https://github.com/acme/api/pull/12"),
    ]);
    expect(prs).toEqual([{ repo: "acme/api", number: 12, url: "https://github.com/acme/api/pull/12" }]);
  });

  it("ignores pull request links the agent merely looked at", () => {
    const prs = createdPrs([
      claudeCall("t1", "gh pr view 7 -R acme/api"),
      claudeResult("t1", "https://github.com/acme/api/pull/7"),
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "See https://github.com/acme/api/pull/8" }] } }),
    ]);
    expect(prs).toEqual([]);
  });

  it("reads tool results stored as content blocks", () => {
    const prs = createdPrs([
      claudeCall("t1", "gh pr create -f"),
      claudeResult("t1", [{ type: "text", text: "https://github.com/acme/api/pull/3" }]),
    ]);
    expect(prs.map((pr) => pr.url)).toEqual(["https://github.com/acme/api/pull/3"]);
  });

  it("pairs a Codex function call with its output", () => {
    const prs = createdPrs([
      codexCall("c1", "gh pr create --fill"),
      codexOutput("c1", "Process exited with code 0\nOutput:\nhttps://github.com/acme/web/pull/41\n"),
      codexCall("c2", "gh pr list"),
      codexOutput("c2", "#42 https://github.com/acme/web/pull/42"),
    ]);
    expect(prs).toEqual([{ repo: "acme/web", number: 41, url: "https://github.com/acme/web/pull/41" }]);
  });

  it("lists each pull request once and skips lines that are not records", () => {
    const prs = createdPrs([
      "not json",
      claudeCall("t1", "gh pr create"),
      claudeResult("t1", "https://github.com/acme/api/pull/5"),
      claudeCall("t2", "gh pr create"),
      claudeResult("t2", "already exists: https://github.com/acme/api/pull/5"),
    ]);
    expect(prs.map((pr) => pr.number)).toEqual([5]);
  });
});
