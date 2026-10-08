import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CanvasFrame } from "../../../main/canvas.js";
import { Icon } from "../board/icons.js";
import { useExtensions } from "../extensions/ExtensionProvider.js";

// Side panel next to the terminal pane: what the agent posted through the
// deck-canvas skill while it planned and answered, one tab per title. The
// panel shows the tab touched last (a new one, or a status list updated in
// place) until the person picks a tab; the next post brings its tab forward
// again. ← → move between tabs.

const touched = (frame: CanvasFrame) => frame.updatedAt ?? frame.createdAt;

export function CanvasPanel({ termId, frames, onClose }: { termId?: string; frames: CanvasFrame[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string>();
  const host = useRef<HTMLDivElement>(null);
  const latest = frames.reduce<CanvasFrame | undefined>((best, frame) => (!best || touched(frame) > touched(best) ? frame : best), undefined);
  const frame = frames.find((frame) => frame.id === picked) ?? latest;
  const shown = frame ? frames.indexOf(frame) : -1;

  // A post or an update is the agent asking for a look: it wins over a pick.
  const lastTouch = useRef(0);
  useEffect(() => {
    const now = latest ? touched(latest) : 0;
    if (now > lastTouch.current) setPicked(undefined);
    lastTouch.current = now;
  }, [latest?.id, latest ? touched(latest) : 0]);
  useEffect(() => { setPicked(undefined); }, [termId]);

  const step = (by: number) => {
    const next = frames[Math.min(frames.length - 1, Math.max(0, shown + by))];
    if (next) setPicked(next.id);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!host.current?.contains(document.activeElement)) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={host} tabIndex={-1} className="flex w-[560px] shrink-0 flex-col border-l border-edge outline-none">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 font-sans">
        <span className="text-xs font-bold text-ink">canvas</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-mut">{frame?.title ?? ""}</span>
        {termId && frames.length > 0 && <button onClick={() => void window.deck.canvas.clear(termId)} title="Clear the canvas" className="text-[10px] text-dim hover:text-ink">clear</button>}
        <button onClick={onClose} title="Close (⌘⇧E)" className="text-dim hover:text-ink">×</button>
      </div>
      {frames.length > 1 && (
        <div role="tablist" aria-label="Canvas tabs" className="flex shrink-0 gap-1 overflow-x-auto border-b border-edge px-2 py-1.5 font-sans text-[11px]">
          {frames.map((tab) => (
            <div key={tab.id} className={`group flex shrink-0 items-center gap-1 rounded px-2 py-0.5 ${tab.id === frame?.id ? "bg-card2 text-soft" : "text-mut hover:text-soft"}`}>
              <button role="tab" aria-selected={tab.id === frame?.id} onClick={() => setPicked(tab.id)} className="max-w-[180px] truncate" title={tab.title}>{tab.title}</button>
              {termId && <button onClick={() => void window.deck.canvas.remove(termId, tab.id)} title={`Close ${tab.title}`} aria-label={`Close ${tab.title}`} className="text-dim opacity-0 hover:text-ink group-hover:opacity-100">×</button>}
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {!frame && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center font-sans text-[11px] text-dim">
            <Icon name="canvas" size={22} />
            <div>Nothing here yet.</div>
            <div>Claude puts plans, drawings, answers and todo lists here while it works with you.</div>
          </div>
        )}
        {frame && <Frame key={frame.id} frame={frame} termId={termId} />}
      </div>
    </div>
  );
}

function Frame({ frame, termId }: { frame: CanvasFrame; termId?: string }) {
  const { theme } = useExtensions();
  if (frame.format === "mermaid") return <MermaidFrame source={frame.content} dark={theme.appearance === "dark"} />;
  if (frame.format === "svg") return (
    <div className="p-3">
      <img alt={frame.alt ?? frame.title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(frame.content)}`} className="h-auto w-full rounded-md bg-card" />
    </div>
  );
  // A page the agent wrote runs in a sandbox: scripts yes, nothing of deck's.
  if (frame.format === "html") return <iframe title={frame.title} sandbox="allow-scripts allow-popups" srcDoc={frame.content} className="h-full min-h-[480px] w-full border-0 bg-white" />;
  if (frame.format === "markdown") return <div className="px-4 py-2"><CanvasMarkdown frame={frame} termId={termId} /></div>;
  if (frame.format === "link") return (
    <div className="flex flex-col gap-3 p-4 font-sans text-[12px]">
      <a href={frame.content} onClick={(event) => { event.preventDefault(); window.open(frame.content); }} className="break-all text-accent underline">{frame.content}</a>
      <iframe title={frame.title} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" src={frame.content} className="min-h-[480px] w-full flex-1 rounded-md border border-edge bg-white" />
    </div>
  );
  return <pre className={`overflow-auto px-4 py-3 font-mono text-[12px] leading-[1.35] text-body ${frame.format === "ascii" ? "whitespace-pre" : "whitespace-pre-wrap"}`}>{frame.content}</pre>;
}

// Markdown with live task lists: ticking a `- [ ]` item rewrites that line of
// the frame, so the agent reads the person's ticks back through the canvas.
// The generated checkbox carries no source position but its list item does,
// so the item hears the change. No raw HTML here: that parser would drop the
// positions, and nothing the agent posts needs it.
function CanvasMarkdown({ frame, termId }: { frame: CanvasFrame; termId?: string }) {
  return (
    <div className="md font-sans text-[12px] leading-relaxed text-body [&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:align-middle [&_input[type=checkbox]]:accent-[var(--color-accent)] [&_li:has(>input)]:list-none [&_li:has(>input)]:-ml-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) window.open(href); }}>{children}</a>,
          li: ({ node, children, className }) => {
            const line = node?.position?.start.line;
            const isTask = className?.includes("task-list-item") && line !== undefined && termId !== undefined;
            return (
              <li className={className} onChange={isTask ? (event) => { if ((event.target as HTMLInputElement).type === "checkbox") void window.deck.canvas.toggleTask(termId, frame.id, line); } : undefined}>
                {children}
              </li>
            );
          },
          input: ({ checked, type, disabled }) => type === "checkbox"
            ? <input type="checkbox" checked={Boolean(checked)} aria-label="Toggle task" onChange={() => {}} disabled={disabled && !termId} className="cursor-pointer" />
            : <input type={type} disabled />,
        }}
      >
        {frame.content}
      </ReactMarkdown>
    </div>
  );
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
