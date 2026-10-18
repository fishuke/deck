import type { View } from "../App.js";
import { primaryHint, primaryModifier } from "../../../shared/keybinds.js";
import { shortPath } from "../lib/useGitSummary.js";
import type { SettingsSection } from "../chrome/SettingsView.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "../../../main/indexer.js";
import type { GithubHit, RepoDir } from "../../../main/providers.js";
import { runningCommand, useTabs } from "../store.js";
import { usePaletteActions, type PaletteGroup, type PaletteItem } from "./paletteActions.js";

// The ⌘K overlay from the deck design: grouped results, open sessions and
// actions first, then conversations, repos and pull requests. ⏎ opens,
// ⌘⏎ opens in a new session.

export interface SearchOverlayProps {
  onClose: () => void;
  onView: (view: View) => void;
  onSettings: (section: SettingsSection) => void;
  onSidebar: () => void;
  onPreview: (sessionId: string, query: string) => void;
}

export function SearchOverlay({ onClose, onPreview, onView, onSettings, onSidebar }: SearchOverlayProps) {
  const { newTab, tabs, focusTab } = useTabs();
  const paletteGroups = usePaletteActions({ onView, onSettings, onSidebar });
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [convHits, setConvHits] = useState<SearchHit[]>([]);
  const [repos, setRepos] = useState<RepoDir[]>([]);
  const [ghHits, setGhHits] = useState<GithubHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    void window.deck.search.listRepos().then(setRepos);
  }, []);

  useEffect(() => {
    setSel(0);
    if (!query.trim()) {
      setConvHits([]);
      setGhHits([]);
      return;
    }
    const t = setTimeout(() => {
      void window.deck.search.query(query).then(setConvHits);
    }, 150);
    // GitHub search is remote and rate-limited: debounce much harder.
    const g = setTimeout(() => {
      void window.deck.search.github(query).then(setGhHits);
    }, 600);
    return () => {
      clearTimeout(t);
      clearTimeout(g);
    };
  }, [query]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (item: PaletteItem) => `${item.title} ${item.meta} ${item.keywords ?? ""}`.toLowerCase().includes(q);
    const conv = new Map<string, SearchHit>();
    for (const h of convHits) if (!conv.has(h.session_id)) conv.set(h.session_id, h);
    const out: PaletteGroup[] = [];
    const liveTabs = tabs.filter((tab) => `${tab.customTitle ?? ""} ${tab.title} ${runningCommand(tab) ?? ""} ${tab.cwd ?? ""} ${tab.agent ?? ""}`.toLowerCase().includes(q));
    if (liveTabs.length) out.push({ label: "OPEN SESSIONS", items: liveTabs.slice(0, 6).map((tab) => {
      const position = tabs.indexOf(tab);
      return {
        icon: tab.agent ? "✳" : "❯", iconColor: "text-mut", title: tab.customTitle || runningCommand(tab) || tab.title,
        meta: [tab.cwd && shortPath(tab.cwd), position < 9 && `${primaryHint}${position + 1}`].filter(Boolean).join(" · "),
        open: () => { focusTab(tab.termId); onView("terminal"); },
      };
    }) });
    for (const group of paletteGroups) {
      const items = group.items.filter((item) => (q || !item.whenTyping) && matches(item));
      if (items.length) out.push({ label: group.label, items });
    }
    if (conv.size) {
      out.push({
        label: "CONVERSATIONS",
        items: [...conv.values()].slice(0, 5).map((h) => ({
          icon: "✳",
          iconColor: "text-accent",
          title: h.title ?? h.session_id,
          meta: `${h.agent} · ${h.project.replace(/^-Users-[^-]+-/, "")}`,
          open: (newPane) =>
            newPane
              ? void newTab({ agent: h.agent, cwd: h.cwd ?? undefined, sessionId: h.session_id })
              : onPreview(h.session_id, query),
        })),
      });
    }
    const repoMatches = q ? repos.filter((r) => r.name.toLowerCase().includes(q)) : [];
    if (repoMatches.length) {
      out.push({
        label: "REPOS",
        items: repoMatches.slice(0, 4).map((r) => ({
          icon: "⌂",
          iconColor: "text-blue",
          title: r.name,
          meta: r.path.replace(/^\/Users\/[^/]+/, "~"),
          open: () => void newTab({ cwd: r.path }),
        })),
      });
    }
    if (ghHits.length) {
      out.push({
        label: "PULL REQUESTS & ISSUES",
        items: ghHits.slice(0, 5).map((h) => ({
          icon: h.kind === "pr" ? "⇄" : "◫",
          iconColor: h.kind === "pr" ? "text-green" : "text-orange",
          title: `#${h.number} ${h.title}`,
          meta: `${h.repository.split("/")[1] ?? h.repository} · ${h.state.toLowerCase()}`,
          open: () => window.open(h.url),
        })),
      });
    }
    return out;
  }, [convHits, repos, ghHits, query, newTab, onPreview, tabs, focusTab, onView, paletteGroups]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flat[sel];
        if (item) {
          item.open(primaryModifier(e));
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [flat, sel, onClose]);

  let idx = -1;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-center bg-black/60 pt-[12vh]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-fit max-h-[60vh] w-[620px] flex-col overflow-hidden rounded-xl border border-edge3 bg-overlay shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-3 border-b border-edge2 px-4.5 py-3.5">
          <span className="text-dim">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search Deck"
            placeholder="Search sessions, history, commands, settings, repos…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-dim"
          />
          <span className="rounded border border-edge2 px-1.5 py-px text-[10px] text-dim">esc</span>
        </div>
        <div className="overflow-y-auto p-1.5">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pb-1 pt-2 text-[10px] tracking-widest text-dim">{g.label}</div>
              {g.items.map((item) => {
                idx++;
                const i = idx;
                return (
                  <button
                    key={`${g.label}${i}`}
                    aria-label={item.title}
                    onClick={(e) => {
                      item.open(primaryModifier(e));
                      onClose();
                    }}
                    onMouseMove={() => setSel(i)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                      sel === i ? "bg-card2" : ""
                    }`}
                  >
                    <span className={`w-4 text-center ${item.iconColor}`}>{item.icon}</span>
                    <span className="flex-1 truncate text-xs text-soft">{item.title}</span>
                    <span className="shrink-0 text-[10px] text-dim">{item.meta}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {query.trim() !== "" && flat.length === 0 && (
            <div className="p-6 text-center text-xs text-dim">
              Nothing local — GitHub results load as you type
            </div>
          )}
        </div>
        <div className="flex gap-4 border-t border-edge2 px-4.5 py-2.5 text-[10px] text-dim">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span>{primaryHint}⏎ open in new session</span>
          <span className="ml-auto">sessions · commands · settings · conversations</span>
        </div>
      </div>
    </div>
  );
}
