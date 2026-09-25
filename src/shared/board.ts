import type { BoardProviderKind } from "./settings.js";

/** Product names of the trackers the board can mirror, for labels on both sides. */
export const boardProviderLabels: Record<BoardProviderKind, string> = {
  jira: "Jira",
  linear: "Linear",
  github: "GitHub Projects",
};

/** Where a self-hosted Jira address stops being the site and starts being a
 *  page on it. Atlassian Cloud sites have no context path, so only the origin counts. */
const JIRA_PAGE = /\/(?:browse|secure|projects|plugins|issues)(?:\/|$)/;

/** Reads whatever was pasted as the Jira address, a bare domain or a link to
 *  any page, as the site root, plus the board id when the link points at one. */
export function parseJiraUrl(input: string): { baseUrl: string; boardId?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { baseUrl: "" };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { baseUrl: trimmed };
  }
  const page = url.pathname.search(JIRA_PAGE);
  const contextPath = url.hostname.endsWith(".atlassian.net")
    ? ""
    : (page === -1 ? url.pathname : url.pathname.slice(0, page)).replace(/\/+$/, "");
  const boardId = url.pathname.match(/\/boards\/(\d+)/)?.[1] ?? url.searchParams.get("rapidView") ?? undefined;
  return { baseUrl: `${url.origin}${contextPath}`, boardId };
}
