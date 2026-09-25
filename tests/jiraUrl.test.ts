import { describe, expect, it } from "vitest";
import { parseJiraUrl } from "../src/shared/board.js";

describe("parseJiraUrl", () => {
  it("adds https to a bare domain", () => {
    expect(parseJiraUrl("yourorg.atlassian.net")).toEqual({ baseUrl: "https://yourorg.atlassian.net" });
  });

  it("keeps an explicit scheme and drops the trailing slash", () => {
    expect(parseJiraUrl(" http://jira.local/ ")).toEqual({ baseUrl: "http://jira.local" });
  });

  it("reads the site and board id from a cloud board link", () => {
    expect(parseJiraUrl("https://yourorg.atlassian.net/jira/software/c/projects/INI/boards/25?selectedIssue=INI-1"))
      .toEqual({ baseUrl: "https://yourorg.atlassian.net", boardId: "25" });
  });

  it("strips an issue link down to the site", () => {
    expect(parseJiraUrl("yourorg.atlassian.net/browse/INI-42")).toEqual({ baseUrl: "https://yourorg.atlassian.net" });
  });

  it("keeps the context path of a self-hosted Jira", () => {
    expect(parseJiraUrl("https://host.example.com/jira/secure/RapidBoard.jspa?rapidView=7"))
      .toEqual({ baseUrl: "https://host.example.com/jira", boardId: "7" });
    expect(parseJiraUrl("https://host.example.com/tracker/secure/RapidBoard.jspa?rapidView=7"))
      .toEqual({ baseUrl: "https://host.example.com/tracker", boardId: "7" });
  });

  it("leaves an empty value empty", () => {
    expect(parseJiraUrl("   ")).toEqual({ baseUrl: "" });
  });
});
