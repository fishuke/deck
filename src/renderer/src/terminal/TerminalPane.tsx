import { useExtensions } from "../extensions/ExtensionProvider.js";
import { useDisplayMode } from "../chrome/DisplayMode.js";
import { useTerminalAppearance } from "../lib/useTerminalAppearance.js";
import { useSettings } from "../lib/useSettings.js";
import { chordOf, resolveKeybinds } from "../../../shared/keybinds.js";
import { onTerminalAction } from "./actions.js";
import { ContextBar } from "./ContextBar.js";
import { trackTypedInput } from "../../../shared/tips.js";
import { applyTabColor, type TabColorChannels } from "../../../shared/tabColor.js";
import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";


export interface TerminalPaneProps {
  termId: string;
  /** The shell's current folder, for the context bar. */
  cwd?: string;
  /** A program other than the shell is running; the context bar cannot type into it. */
  busy?: boolean;
  active: boolean;
  focused?: boolean;
  onTitle: (title: string) => void;
  /** A line the user typed and submitted, as far as the keystrokes reveal it. */
  onCommand?: (command: string) => void;
  /** The tab color the running program asked for over OSC 6, null to clear. */
  onTabColor?: (color: string | null) => void;
  onFileDrop?: () => void;
}

// One xterm instance per pty, mounted once and kept alive across tab
// switches (hidden, not unmounted) so scrollback survives.
export function TerminalPane({ termId, cwd, busy, active, focused = active, onTitle, onCommand, onTabColor, onFileDrop }: TerminalPaneProps) {
  const { theme } = useExtensions();
  const { mode, presentationSize } = useDisplayMode();
  const appearance = useTerminalAppearance();
  // Chords Deck handles itself; the terminal must let them bubble instead of typing them.
  const boundChords = useRef(new Set<string>());
  const keybinds = useSettings()?.keybinds;
  useEffect(() => { boundChords.current = new Set(Object.values(resolveKeybinds(keybinds))); }, [keybinds]);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState("");
  const searchPosition = useRef(-1);
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon>();
  const termRef = useRef<Terminal>();
  const typed = useRef("");
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onTabColorRef = useRef(onTabColor);
  onTabColorRef.current = onTabColor;

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      theme: theme.terminal,
      ...appearance,
      macOptionIsMeta: true,
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, url) => window.open(url)));
    term.open(host);
    term.attachCustomKeyEventHandler((event) => {
      // Cmd+Backspace clears the line, as in Terminal.app and iTerm2; xterm would send a single delete.
      if (event.type === "keydown" && event.metaKey && event.key === "Backspace") {
        window.deck.term.input(termId, "\x15");
        return false;
      }
      // macOptionIsMeta turns every Option combo into ESC+key, but non-US layouts
      // type symbols such as @ { } [ ] | with Option. Send those as text.
      if (event.type === "keydown" && event.altKey && !event.metaKey && !event.ctrlKey && /^[!-\/:-@\[-`{-~]$/.test(event.key)) {
        window.deck.term.input(termId, event.key);
        return false;
      }
      return !((event.metaKey && !event.shiftKey && !event.altKey && /^Digit[1-9]$/.test(event.code)) || boundChords.current.has(chordOf(event) ?? ""));
    });

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL can be unavailable (e.g. GPU disabled); canvas fallback is fine.
    }
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let restored = false;
    let disposed = false;
    let live: { data: string; sequence: number }[] = [];
    const offData = window.deck.term.onData((id, data, sequence) => {
      if (id !== termId) return;
      if (restored) term.write(data); else live.push({ data, sequence });
    });
    const onInput = term.onData((data) => {
      window.deck.term.input(termId, data);
      const input = trackTypedInput(typed.current, data);
      typed.current = input.typed;
      if (input.submitted) onCommandRef.current?.(input.submitted);
    });
    const onTitleChange = term.onTitleChange(onTitle);
    // iTerm2's tab color extension. xterm has no handler for it, so without
    // this the sequences are parsed and dropped.
    let channels: TabColorChannels = {};
    const onTabColorOsc = term.parser.registerOscHandler(6, (payload) => {
      const result = applyTabColor(channels, payload);
      channels = result.channels;
      if (result.color !== undefined) onTabColorRef.current?.(result.color);
      return true;
    });
    // One pty can be shown by two panes (a PR's agent panel and its terminal
    // tab). Only a visible pane may size the pty; a hidden one cannot measure
    // itself and would push a bogus size to the process.
    // Layout also settles in steps (pane drags, sidebar toggles, window
    // resizes) and the fit addon clamps a momentarily tiny host to 2 columns.
    // A TUI that redraws at such a width leaves wrapped frames in the
    // scrollback that later redraws overlap, so xterm fits at once but the
    // process only hears a size that has held for a moment. A hidden window
    // is skipped too: the quake panel follows the display under the cursor,
    // so a lid close moves it to the laptop screen and back while nobody is
    // looking, and the process would redraw at each width in between.
    let claim: ReturnType<typeof setTimeout> | undefined;
    const claimSize = () => {
      clearTimeout(claim);
      claim = setTimeout(() => { if (!disposed && host.clientWidth > 0 && document.visibilityState === "visible") window.deck.term.resize(termId, term.cols, term.rows); }, 100);
    };
    const onResize = term.onResize(claimSize);
    const onVisibility = () => { if (document.visibilityState === "visible" && host.clientWidth > 0) { fit.fit(); claimSize(); } };
    document.addEventListener("visibilitychange", onVisibility);
    claimSize();
    void window.deck.term.attach(termId).then(({ buffer, sequence, cols, rows }) => {
      if (disposed) return;
      // The replay was laid out for the pty's last size, which another window
      // (a docked panel, a resized one) may not share. Rendering it at that
      // size and then fitting reflows it the way a real resize would, and the
      // size change tells the running program to redraw.
      const resized = cols > 0 && rows > 0 && (cols !== term.cols || rows !== term.rows);
      if (resized) term.resize(cols, rows);
      if (buffer) term.write(buffer);
      for (const chunk of live) if (chunk.sequence > sequence) term.write(chunk.data);
      live = []; restored = true;
      // Writes parse asynchronously, so refit only once the replay is laid out.
      if (resized) term.write("", () => { if (!disposed && host.clientWidth > 0) { fit.fit(); claimSize(); } });
    }).catch((error) => { if (!disposed) term.writeln(`\r\nCould not restore terminal: ${String(error)}`); });

    // Reclaim the pty on every reveal too: another pane may have resized it
    // meanwhile, and xterm only reports a resize when its own grid changed.
    const observer = new ResizeObserver(() => {
      if (host.clientWidth === 0) return;
      fit.fit();
      claimSize();
    });
    observer.observe(host);

    return () => {
      disposed = true;
      clearTimeout(claim);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      offData();
      onInput.dispose();
      onTitleChange.dispose();
      onTabColorOsc.dispose();
      onResize.dispose();
      term.dispose();
    };
  }, [termId]);

  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      if (focused && !finding) termRef.current?.focus();
    }
  }, [active, focused, finding]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = mode === "presentation" ? presentationSize : appearance.fontSize;
    term.options.lineHeight = mode === "presentation" ? 1.25 : appearance.lineHeight;
    const frame = requestAnimationFrame(() => { if (active) fitRef.current?.fit(); });
    return () => cancelAnimationFrame(frame);
  }, [mode, presentationSize, active, appearance.fontSize, appearance.lineHeight]);

  useEffect(() => { if (termRef.current) termRef.current.options.theme = theme.terminal; }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = appearance.fontFamily;
    term.options.fontWeight = appearance.fontWeight;
    term.options.fontWeightBold = appearance.fontWeightBold;
    term.options.cursorBlink = appearance.cursorBlink;
    term.options.cursorStyle = appearance.cursorStyle;
    if (active) fitRef.current?.fit();
  }, [appearance.fontFamily, appearance.fontWeight, appearance.fontWeightBold, appearance.cursorBlink, appearance.cursorStyle, active]);

  const find = (backwards = false) => {
    const term = termRef.current;
    if (!term || !query) return;
    const matches: { line: number; column: number }[] = [];
    for (let line = 0; line < term.buffer.active.length; line++) {
      const text = term.buffer.active.getLine(line)?.translateToString(true) ?? "";
      let column = text.toLowerCase().indexOf(query.toLowerCase());
      while (column >= 0) {
        matches.push({ line, column });
        column = text.toLowerCase().indexOf(query.toLowerCase(), column + Math.max(query.length, 1));
      }
    }
    if (!matches.length) { setMatch("No matches"); term.clearSelection(); return; }
    searchPosition.current = (searchPosition.current + (backwards ? -1 : 1) + matches.length) % matches.length;
    const found = matches[searchPosition.current];
    term.select(found.column, found.line, query.length);
    term.scrollToLine(Math.max(0, found.line - 2));
    setMatch(`${searchPosition.current + 1} / ${matches.length}`);
  };

  // Finder drops arrive as File objects with no path in the renderer; the
  // preload resolves them. Paths go in as one bracketed paste, shell-quoted,
  // so agents like Claude Code pick a dropped image up as an attachment.
  const dropFiles = (event: React.DragEvent) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files, (file) => window.deck.term.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    onFileDrop?.();
    const quoted = paths.map((path) => /[^\w./-]/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : path).join(" ");
    window.deck.term.input(termId, `\x1b[200~${quoted} \x1b[201~`);
    setFinding(false);
    termRef.current?.focus();
    // A Finder drop can leave the app inactive. Reclaim keyboard focus after
    // the native drag finishes, then focus the pane that received the files.
    requestAnimationFrame(() => {
      if (!hostRef.current?.clientWidth) return;
      void window.deck.window.focus().then(() => {
        if (hostRef.current?.clientWidth) termRef.current?.focus();
      }).catch((error) => console.error("Could not focus terminal after file drop:", error));
    });
  };

  useEffect(() => onTerminalAction((action) => {
    if (!active || !focused) return;
    const term = termRef.current;
    if (!term) return;
    if (action === "find") setFinding((open) => !open);
    if (action === "clear") {
      term.clear();
      // A full-screen TUI only repaints on a size change, so nudge the pty or
      // the cleared viewport stays blank until the program's next update.
      window.deck.term.resize(termId, term.cols - 1, term.rows);
      window.deck.term.resize(termId, term.cols, term.rows);
    }
    if (action === "focus") term.focus();
    if (action === "export") {
      const lines = Array.from({ length: term.buffer.active.length }, (_, index) => term.buffer.active.getLine(index)?.translateToString(true) ?? "");
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
      const link = document.createElement("a"); link.href = url; link.download = `deck-terminal-${termId}.txt`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }), [active, focused, termId]);

  return <div style={{ background: theme.terminal.background }} onDragOver={(event) => event.preventDefault()} onDrop={dropFiles} className={`relative flex h-full w-full flex-col px-4 py-3 ${active ? "" : "hidden"}`}>
    {finding && <div className="absolute right-1 top-0 z-20 flex items-center gap-2 rounded-md border border-edge3 bg-overlay px-2 py-1.5 font-sans text-[11px] shadow-lg">
      <input aria-label="Find terminal output" autoFocus placeholder="Find in terminal…" value={query} onChange={(event) => { setQuery(event.target.value); searchPosition.current = -1; setMatch(""); }} onKeyDown={(event) => { if (event.key === "Enter") find(event.shiftKey); if (event.key === "Escape") { setFinding(false); termRef.current?.focus(); } }} className="w-40 bg-transparent text-soft outline-none" />
      <span className="text-dim">{match}</span><button title="Previous match" onClick={() => find(true)}>↑</button><button title="Next match" onClick={() => find()}>↓</button><button title="Close find" onClick={() => setFinding(false)}>×</button>
    </div>}
    <ContextBar termId={termId} cwd={cwd} busy={busy} />
    <div ref={hostRef} className="min-h-0 w-full flex-1" />
  </div>;
}
