import { sessionAgent, sessionKey, type AgentLaunch } from "../../shared/agents.js";
import type { TermMeta } from "../../main/pty.js";
import type { AgentSession } from "../../main/sessions.js";
import type { Worktree } from "../../main/worktrees.js";
import { useSettings } from "./lib/useSettings.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Terminal tabs live at app level so the sidebar, search overlay and
// terminal view all share them.

export interface TermTab extends AgentLaunch {
  termId: string;
  title: string;
  cwd?: string;
  /** A program other than the shell is running, so the tab is not at a prompt. */
  busy?: boolean;
  customTitle?: string;
  /** Color the running program set over OSC 6; agents tint per state. */
  tabColor?: string;
  /** agent session this tab was opened to resume. */
  sessionId?: string;
}

export interface OpenOptions extends AgentLaunch {
  cwd?: string;
  command?: string;
  issueKey?: string;
  /** Resume this agent session; a tab already resuming it is focused instead. */
  sessionId?: string;
}

/** A close waiting on the user's answer about the tab's worktree. */
export interface WorktreeClose {
  termId: string;
  worktree: Worktree;
}

interface TabStore {
  tabs: TermTab[];
  activeId?: string;
  /** False until terminals surviving from before the reload are restored. */
  ready: boolean;
  newTab: (opts?: OpenOptions) => Promise<void>;
  closeTab: (termId: string, kill?: boolean) => void;
  /** Closes a tab, first asking about its worktree when it has one. */
  requestCloseTab: (termId: string) => void;
  /** Set while that question is on screen. */
  worktreeClose?: WorktreeClose;
  dismissWorktreeClose: () => void;
  /** Reopens the most recently closed tab: the same session for an agent tab, a shell in the same folder otherwise. */
  reopenTab: () => Promise<void>;
  focusTab: (termId: string) => void;
  setTitle: (termId: string, title: string) => void;
  setTabColor: (termId: string, color: string | null) => void;
  renameTab: (termId: string, title: string) => void;
  moveTab: (termId: string, index: number) => void;
}

const Ctx = createContext<TabStore | null>(null);

export function TabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [worktreeClose, setWorktreeClose] = useState<WorktreeClose>();
  const settings = useSettings();

  const toTab = (meta: TermMeta): TermTab => ({
    termId: meta.id,
    title: meta.agent ?? meta.command?.split(" ")[0] ?? "shell",
    cwd: meta.cwd,
    busy: meta.busy,
    customTitle: localStorage.getItem(`deck.tab.name.${meta.id}`) ?? undefined,
    agent: meta.agent ?? (/^codex(?:\s|$)/.test(meta.command ?? "") ? "codex" : /^claude(?:\s|$)/.test(meta.command ?? "") ? "claude" : undefined),
    sessionId: meta.sessionId ?? (meta.command?.startsWith("codex resume ") ? sessionKey("codex", /codex resume ['"]?([^\s'"]+)/.exec(meta.command)?.[1] ?? "") : undefined) ?? /--resume ['"]?([^\s'"]+)/.exec(meta.command ?? "")?.[1],
  });

  // The agent running in a tab is only known through its hooks, so a tab
  // carries the session live in its terminal; that is what a reopen resumes.
  const withSession = (tab: TermTab, sessions: AgentSession[]): TermTab => {
    const session = sessions.find((session) => session.term_id === tab.termId && session.status !== "ended" && !session.session_id.startsWith("pending:"));
    return session ? { ...tab, sessionId: session.session_id, agent: session.agent, cwd: tab.cwd || session.cwd } : tab;
  };

  // Callbacks read the live tab list, and a session being resumed is held
  // here until its tab exists so a double click can't open it twice.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeCwd = useRef<string>();
  activeCwd.current = settings?.newTerminalCwd.tab === "current" ? tabs.find((tab) => tab.termId === activeId)?.cwd : undefined;
  const resuming = useRef(new Set<string>());
  const closed = useRef<TermTab[]>([]);

  // Terminals live in the pty host, so a reload (or a restarted main
  // process) finds the previous tabs still running. The list is re-read when
  // the window settings change, since they decide which tabs this window sees.
  const windowMode = settings?.windowMode;
  const hotkeyOwnTabs = settings?.hotkeyOwnTabs;
  useEffect(() => {
    void Promise.all([window.deck.term.list(), window.deck.sessions.list()]).then(([terms, sessions]) => {
      const order: string[] = JSON.parse(localStorage.getItem("deck.tab.order") ?? "[]");
      const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
      setTabs([...terms].sort((a, b) => rank(a.id) - rank(b.id)).map((meta) => withSession(toTab(meta), sessions)));
      setActiveId((active) => terms.some((term) => term.id === active) ? active : terms.at(-1)?.id);
      setReady(true);
    });
  }, [windowMode, hotkeyOwnTabs]);

  useEffect(() => window.deck.sessions.onChanged((sessions) => {
    setTabs((tabs) => tabs.map((tab) => withSession(tab, sessions)));
  }), []);

  const newTab = useCallback(async (opts: OpenOptions = {}) => {
    const agent = opts.agent ?? (opts.sessionId ? sessionAgent(opts.sessionId) : undefined);
    const sessionId = opts.sessionId ? sessionKey(agent!, opts.sessionId) : undefined;
    // Work for an issue belongs in its repo or the default folder, never in
    // whatever folder the active terminal happens to be in.
    const cwd = opts.cwd ?? (opts.issueKey ? undefined : activeCwd.current);
    const create = { ...opts, cwd, agent, sessionId };
    if (sessionId && resuming.current.has(sessionId)) return;
    if (sessionId) resuming.current.add(sessionId);
    try {
      if (sessionId) {
        const sessions = await window.deck.sessions.list();
        const session = sessions.find((session) => session.session_id === sessionId);
        const open = tabsRef.current.find((tab) => tab.sessionId === sessionId);
        if (open && session?.status !== "ended") { setActiveId(open.termId); return; }
        const live = session?.status !== "ended" && tabsRef.current.find((tab) => tab.termId === session?.term_id);
        if (live) { setActiveId(live.termId); return; }
      }
      const meta = await window.deck.term.create(create);
      setTabs((tabs) => tabs.some((tab) => tab.termId === meta.id) ? tabs : [...tabs, toTab(meta)]);
      setActiveId(meta.id);
    } finally {
      if (sessionId) resuming.current.delete(sessionId);
    }
  }, []);

  useEffect(() => window.deck.term.onCreated((meta) => {
    setTabs((tabs) => tabs.some((tab) => tab.termId === meta.id) ? tabs : [...tabs, toTab(meta)]);
  }), []);

  const closeTab = useCallback((termId: string, kill = true) => {
    if (kill) window.deck.term.kill(termId);
    // A killed terminal also reports its exit, so the same tab may arrive here twice.
    const tab = tabsRef.current.find((tab) => tab.termId === termId);
    if (tab && closed.current.at(-1)?.termId !== termId) closed.current = [...closed.current.slice(-9), tab];
    localStorage.removeItem(`deck.tab.name.${termId}`);
    setTabs((tabs) => {
      const i = tabs.findIndex((t) => t.termId === termId);
      const next = tabs.filter((t) => t.termId !== termId);
      setActiveId((active) =>
        active === termId ? next[Math.min(i, next.length - 1)]?.termId : active,
      );
      return next;
    });
  }, []);

  // Only a tab sitting in a linked worktree raises the question, so an ordinary
  // tab still closes on the first click.
  const requestCloseTab = useCallback((termId: string) => {
    const tab = tabsRef.current.find((tab) => tab.termId === termId);
    if (!tab?.cwd) { closeTab(termId); return; }
    void window.deck.worktrees.at(tab.cwd).then((worktree) => {
      if (!worktree) { closeTab(termId); return; }
      setWorktreeClose({ termId, worktree });
    }, () => closeTab(termId));
  }, [closeTab]);

  const dismissWorktreeClose = useCallback(() => setWorktreeClose(undefined), []);

  const reopenTab = useCallback(async () => {
    const tab = closed.current.pop();
    if (tab) await newTab({ agent: tab.agent, cwd: tab.cwd, sessionId: tab.sessionId });
  }, [newTab]);

  const setTitle = useCallback((termId: string, title: string) => {
    setTabs((tabs) => tabs.map((t) => (t.termId === termId ? { ...t, title } : t)));
  }, []);

  const setTabColor = useCallback((termId: string, color: string | null) => {
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, tabColor: color ?? undefined } : tab));
  }, []);

  const renameTab = useCallback((termId: string, title: string) => {
    localStorage.setItem(`deck.tab.name.${termId}`, title.trim());
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, customTitle: title.trim() || undefined } : tab));
  }, []);

  const moveTab = useCallback((termId: string, index: number) => {
    setTabs((tabs) => {
      const tab = tabs.find((t) => t.termId === termId);
      if (!tab) return tabs;
      const next = tabs.filter((t) => t !== tab);
      next.splice(index, 0, tab);
      localStorage.setItem("deck.tab.order", JSON.stringify(next.map((t) => t.termId)));
      return next;
    });
  }, []);

  useEffect(() => window.deck.term.onCwd((termId, cwd) => {
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, cwd } : tab));
  }), []);

  // Tells main which directory the active tab is in, for the "current
  // project" sharing mode.
  const activeCwdNow = tabs.find((tab) => tab.termId === activeId)?.cwd;
  useEffect(() => { void window.deck.sharing.setCurrentProject(activeCwdNow); }, [activeCwdNow]);

  useEffect(() => window.deck.term.onBusy((termId, busy) => {
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, busy } : tab));
  }), []);

  useEffect(() => window.deck.term.onExit((id) => closeTab(id, false)), [closeTab]);

  const store = useMemo<TabStore>(
    () => ({ tabs, activeId, ready, newTab, closeTab, requestCloseTab, worktreeClose, dismissWorktreeClose, reopenTab, focusTab: setActiveId, setTitle, setTabColor, renameTab, moveTab }),
    [tabs, activeId, ready, newTab, closeTab, requestCloseTab, worktreeClose, dismissWorktreeClose, reopenTab, setTitle, setTabColor, renameTab, moveTab],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useTabs(): TabStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("useTabs outside TabProvider");
  return store;
}
