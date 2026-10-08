import { kvGet, kvSet } from "./db.js";

// The canvas: what an agent posts for the person to look at while it plans
// and answers, kept per terminal as tabs. Claude running in a deck terminal
// has only text, so the deck-canvas skill curls a frame to /api/canvas and
// the terminal's canvas panel renders it: a mermaid chart, an svg, a page, a
// todo list. Each title is one tab; posting a title again replaces that tab,
// so a status list stays in one place instead of piling up.

export const CANVAS_FORMATS = ["mermaid", "svg", "html", "markdown", "code", "ascii", "link"] as const;
export type CanvasFormat = (typeof CANVAS_FORMATS)[number];

export interface CanvasFrame {
  id: string;
  title: string;
  format: CanvasFormat;
  content: string;
  /** Highlighter language for `code`. */
  language?: string;
  /** One line saying what the drawing shows, for places that cannot draw it. */
  alt?: string;
  createdAt: number;
  /** When the content last changed: a tick, or the agent rewriting it. */
  updatedAt: number;
}

/** Tabs kept per terminal; past this the one touched longest ago goes. */
export const MAX_FRAMES = 12;
/** One frame's content; past this the post is refused rather than cut. */
export const MAX_CONTENT = 2_000_000;

const key = (termId: string) => `canvas:${termId}`;

const listeners = new Set<(termId: string, frames: CanvasFrame[]) => void>();

export function onCanvasChanged(cb: (termId: string, frames: CanvasFrame[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function save(termId: string, frames: CanvasFrame[]): CanvasFrame[] {
  kvSet(key(termId), frames);
  for (const cb of listeners) cb(termId, frames);
  return frames;
}

export const isCanvasFormat = (value: unknown): value is CanvasFormat =>
  typeof value === "string" && (CANVAS_FORMATS as readonly string[]).includes(value);

export function getFrames(termId: string): CanvasFrame[] {
  return kvGet<CanvasFrame[]>(key(termId)) ?? [];
}

export interface FrameInput {
  title?: unknown;
  format?: unknown;
  content?: unknown;
  language?: unknown;
  alt?: unknown;
}

/** Checks a posted frame and returns it ready to keep, or the reason it is refused. */
export function parseFrame(input: FrameInput, now = Date.now()): { frame: CanvasFrame } | { error: string } {
  const format = input.format ?? "mermaid";
  if (!isCanvasFormat(format)) return { error: `format must be one of ${CANVAS_FORMATS.join(", ")}` };
  const content = typeof input.content === "string" ? input.content : "";
  if (!content.trim()) return { error: "content is empty" };
  if (content.length > MAX_CONTENT) return { error: `content is longer than ${MAX_CONTENT} characters` };
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 200) : format;
  const frame: CanvasFrame = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, title, format, content, createdAt: now, updatedAt: now };
  if (typeof input.language === "string" && input.language.trim()) frame.language = input.language.trim().slice(0, 40);
  if (typeof input.alt === "string" && input.alt.trim()) frame.alt = input.alt.trim().slice(0, 500);
  return { frame };
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Adds a tab, or replaces the content of the tab that already carries the
 *  title, which keeps its id, its place and its first spelling. */
export function addFrame(termId: string, frame: CanvasFrame): CanvasFrame[] {
  const frames = getFrames(termId);
  const existing = frames.find((other) => sameTitle(other.title, frame.title));
  if (existing) {
    return save(termId, frames.map((other) => (other === existing ? { ...frame, id: existing.id, title: existing.title, createdAt: existing.createdAt } : other)));
  }
  const next = [...frames, frame];
  while (next.length > MAX_FRAMES) {
    const oldest = next.reduce((best, other) => (other !== frame && other.updatedAt < best.updatedAt ? other : best), next.find((other) => other !== frame) ?? frame);
    next.splice(next.indexOf(oldest), 1);
  }
  return save(termId, next);
}

export function removeFrame(termId: string, id: string): CanvasFrame[] {
  const frames = getFrames(termId);
  if (!frames.some((frame) => frame.id === id)) return frames;
  return save(termId, frames.filter((frame) => frame.id !== id));
}

/** Rewrites one frame's content in place: the person ticking a todo item in
 *  the panel, or the agent updating a frame rather than stacking a new one. */
export function updateFrame(termId: string, id: string, content: string): CanvasFrame[] | undefined {
  if (!content.trim() || content.length > MAX_CONTENT) return undefined;
  const frames = getFrames(termId);
  if (!frames.some((frame) => frame.id === id)) return undefined;
  return save(termId, frames.map((frame) => (frame.id === id ? { ...frame, content, updatedAt: Date.now() } : frame)));
}

/** Flips the `[ ]` / `[x]` of a markdown task item on one source line. */
export function toggleTask(content: string, line: number): string {
  const lines = content.split("\n");
  const current = lines[line - 1];
  if (current === undefined) return content;
  lines[line - 1] = current.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/, (_m, open: string, mark: string, close: string) => `${open}${mark === " " ? "x" : " "}${close}`);
  return lines.join("\n");
}

export function clearFrames(termId: string): CanvasFrame[] {
  if (getFrames(termId).length === 0) return [];
  return save(termId, []);
}
