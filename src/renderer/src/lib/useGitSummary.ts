import { useEffect, useState } from "react";
import type { GitSummary } from "../../../main/git.js";

export function useGitSummary(cwd?: string) {
  const [summary, setSummary] = useState<GitSummary | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!cwd) return;
    let cancelled = false;
    const refresh = () => void window.deck.git.summary(cwd).then((next) => { if (!cancelled) setSummary(next); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [cwd]);
  return summary;
}

export function shortPath(cwd?: string): string {
  return cwd?.replace(/^\/(?:Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~") ?? "~";
}
