import { useCallback, useEffect, useMemo, useState } from "react";
import { Diff, Hunk, parseDiff, type FileData } from "react-diff-view";
import "react-diff-view/style/index.css";
import type { AgentSession } from "../../../main/sessions.js";

// Side panel next to the terminal pane: the agent's decisions summary (when
// it asked for review) above every unstaged, staged and untracked change in
// the session's working tree.

function counts(file: FileData): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const hunk of file.hunks)
    for (const change of hunk.changes) {
      if (change.type === "insert") add++;
      else if (change.type === "delete") del++;
    }
  return { add, del };
}

export function ChangesPanel({
  cwd,
  session,
  onClose,
}: {
  cwd?: string;
  session?: AgentSession;
  onClose: () => void;
}) {
  const [diffText, setDiffText] = useState<string>();
  const [error, setError] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!cwd) return;
    const result = await window.deck.git.changes(cwd);
    setDiffText(result.diff);
    setError(result.error);
  }, [cwd]);

  // Refetch whenever the session progresses (each hook event bumps updated_at),
  // and keep polling while open so edits show up as the agent writes them.
  useEffect(() => {
    void refresh();
  }, [refresh, session?.updated_at]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const files = useMemo<FileData[]>(() => {
    if (!diffText) return [];
    try {
      return parseDiff(diffText);
    } catch {
      return [];
    }
  }, [diffText]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex w-[440px] shrink-0 flex-col border-l border-edge">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-xs font-bold text-ink">
          {session?.status === "needs_review" ? "needs review" : "changes"}
        </span>
        <span className="truncate text-[10px] text-dim">{cwd}</span>
        <button onClick={() => void refresh()} title="Refresh" className="ml-auto text-dim hover:text-ink">
          ↻
        </button>
        <button onClick={onClose} title="Close (⌘E)" className="text-dim hover:text-ink">
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {session?.review_note && (
          <div className="border-b border-edge px-3 py-2.5">
            <div className="pb-1 text-[10px] tracking-widest text-orange">DECISIONS</div>
            <div className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-body">
              {session.review_note}
            </div>
          </div>
        )}

        {!cwd && (
          <div className="px-3 py-3 text-[11px] text-dim">
            no working directory known for this tab yet
          </div>
        )}
        {error && <div className="px-3 py-3 text-[11px] text-dim">{error}</div>}
        {cwd && !error && diffText === "" && (
          <div className="px-3 py-3 text-[11px] text-dim">working tree clean ✓</div>
        )}

        {files.map((file) => {
          const filePath = file.newPath || file.oldPath;
          const { add, del } = counts(file);
          const open = !collapsed.has(filePath);
          return (
            <div key={filePath} className="border-b border-edge">
              <button
                onClick={() => toggle(filePath)}
                className="sticky top-0 flex w-full items-center gap-2 bg-panel px-3 py-1.5 text-left font-mono text-[11px] text-mut hover:text-ink"
              >
                <span className="text-dim">{open ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 truncate" title={filePath}>
                  {filePath}
                </span>
                <span className="text-green">+{add}</span>
                <span className="text-red">−{del}</span>
              </button>
              {open && (
                <div className="deck-diff overflow-x-auto text-[11px]">
                  <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                    {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                  </Diff>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
