import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";
import type { CanvasFrame } from "../../../main/canvas.js";
import { Markdown } from "../board/Markdown.js";
import { Icon } from "../board/icons.js";
import { useExtensions } from "../extensions/ExtensionProvider.js";

// Side panel next to the terminal pane: the drawings the agent posted through
// the deck-canvas skill while it planned. The newest frame shows and the
// panel follows new ones until the person steps back; ← → step, L returns to
// the latest.

export function CanvasPanel({ termId, frames, onClose }: { termId?: string; frames: CanvasFrame[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const latest = Math.max(0, frames.length - 1);
  const shown = follow ? latest : Math.min(index, latest);
  const frame = frames[shown];

  useEffect(() => { setFollow(true); }, [termId]);

  const step = (by: number) => {
    const next = Math.min(latest, Math.max(0, shown + by));
    setIndex(next);
    setFollow(next === latest);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!host.current?.contains(document.activeElement)) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      if (event.key === "l" || event.key === "L") { event.preventDefault(); setFollow(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={host} tabIndex={-1} className="flex w-[560px] shrink-0 flex-col border-l border-edge outline-none">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 font-sans">
        <span className="text-xs font-bold text-ink">canvas</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-mut" title={frame?.title}>{frame?.title ?? ""}</span>
        {frames.length > 0 && <span className="text-[10px] tabular-nums text-dim">{shown + 1} / {frames.length}</span>}
        <button onClick={() => step(-1)} disabled={shown === 0} title="Previous drawing (←)" aria-label="Previous drawing" className="text-dim hover:text-ink disabled:opacity-30">‹</button>
        <button onClick={() => step(1)} disabled={shown === latest} title="Next drawing (→)" aria-label="Next drawing" className="text-dim hover:text-ink disabled:opacity-30">›</button>
        {!follow && <button onClick={() => setFollow(true)} title="Follow the latest drawing (L)" className="text-[10px] text-accent">latest</button>}
        {termId && frames.length > 0 && <button onClick={() => void window.deck.canvas.clear(termId)} title="Clear the canvas" className="text-[10px] text-dim hover:text-ink">clear</button>}
        <button onClick={onClose} title="Close (⌘⇧E)" className="text-dim hover:text-ink">×</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!frame && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center font-sans text-[11px] text-dim">
            <Icon name="canvas" size={22} />
            <div>Nothing drawn yet.</div>
            <div>Claude sketches plans, flows and ideas here while it works with you.</div>
          </div>
        )}
        {frame && <Frame key={frame.id} frame={frame} />}
      </div>
    </div>
  );
}

function Frame({ frame }: { frame: CanvasFrame }) {
  const { theme } = useExtensions();
  if (frame.format === "mermaid") return <MermaidFrame source={frame.content} dark={theme.appearance === "dark"} />;
  if (frame.format === "svg") return (
    <div className="p-3">
      <img alt={frame.alt ?? frame.title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(frame.content)}`} className="h-auto w-full rounded-md bg-card" />
    </div>
  );
  // A page the agent wrote runs in a sandbox: scripts yes, nothing of deck's.
  if (frame.format === "html") return <iframe title={frame.title} sandbox="allow-scripts allow-popups" srcDoc={frame.content} className="h-full min-h-[480px] w-full border-0 bg-white" />;
  if (frame.format === "markdown") return <div className="px-4 py-2"><Markdown>{frame.content}</Markdown></div>;
  if (frame.format === "link") return (
    <div className="flex flex-col gap-3 p-4 font-sans text-[12px]">
      <a href={frame.content} onClick={(event) => { event.preventDefault(); window.open(frame.content); }} className="break-all text-accent underline">{frame.content}</a>
      <iframe title={frame.title} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" src={frame.content} className="min-h-[480px] w-full flex-1 rounded-md border border-edge bg-white" />
    </div>
  );
  return <pre className={`overflow-auto px-4 py-3 font-mono text-[12px] leading-[1.35] text-body ${frame.format === "ascii" ? "whitespace-pre" : "whitespace-pre-wrap"}`}>{frame.content}</pre>;
}

let renders = 0;

function MermaidFrame({ source, dark }: { source: string; dark: boolean }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
    mermaid.render(`deck-canvas-${++renders}`, source)
      .then(({ svg }) => { if (!cancelled) { setSvg(svg); setError(""); } })
      .catch((err: unknown) => { if (!cancelled) { setSvg(""); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { cancelled = true; };
  }, [source, dark]);
  if (error) return (
    <div className="p-4 font-sans text-[11px]">
      <div className="text-red">The diagram did not parse: {error}</div>
      <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] text-mut">{source}</pre>
    </div>
  );
  // Rendered by mermaid in strict mode, which sanitizes what the diagram's
  // labels may carry before it ever becomes markup.
  return <div className="deck-mermaid p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
