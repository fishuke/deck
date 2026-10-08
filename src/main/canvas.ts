import { kvGet, kvSet } from "./db.js";

// The canvas: drawings an agent posts for the person to look at while it
// plans, kept per terminal. Claude running in a deck terminal has only text,
// so the deck-canvas skill curls a frame to /api/canvas and the terminal's
// canvas panel renders it: a mermaid chart, an svg, a page, a table.

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
}

/** Frames kept per terminal; older ones fall off the front. */
export const MAX_FRAMES = 50;
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
  const frame: CanvasFrame = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, title, format, content, createdAt: now };
  if (typeof input.language === "string" && input.language.trim()) frame.language = input.language.trim().slice(0, 40);
  if (typeof input.alt === "string" && input.alt.trim()) frame.alt = input.alt.trim().slice(0, 500);
  return { frame };
}

export function addFrame(termId: string, frame: CanvasFrame): CanvasFrame[] {
  return save(termId, [...getFrames(termId), frame].slice(-MAX_FRAMES));
}

export function clearFrames(termId: string): CanvasFrame[] {
  if (getFrames(termId).length === 0) return [];
  return save(termId, []);
}
