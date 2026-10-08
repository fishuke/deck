import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/main/db.js", () => ({
  kvGet: (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : undefined),
  kvSet: (key: string, value: unknown) => kv.set(key, JSON.stringify(value)),
}));
const canvas = await import("../src/main/canvas.js");
const { SKILLS } = await import("../src/main/hooksInstall.js");

describe("canvas frames", () => {
  beforeEach(() => kv.clear());

  it("accepts a drawing with its title and format, defaulting to mermaid", () => {
    const parsed = canvas.parseFrame({ title: "  Flow ", content: "flowchart LR\n A --> B", language: "", alt: "a to b" }, 1000);
    expect("frame" in parsed && parsed.frame).toMatchObject({ title: "Flow", format: "mermaid", content: "flowchart LR\n A --> B", alt: "a to b", createdAt: 1000 });
    expect("frame" in parsed && parsed.frame.language).toBeUndefined();
    const code = canvas.parseFrame({ format: "code", content: "let x = 1", language: "ts" });
    expect("frame" in code && code.frame).toMatchObject({ title: "code", format: "code", language: "ts" });
  });

  it("refuses an unknown format, empty content and oversized content", () => {
    expect(canvas.parseFrame({ format: "gif", content: "x" })).toEqual({ error: expect.stringContaining("format must be one of") });
    expect(canvas.parseFrame({ format: "svg", content: "   " })).toEqual({ error: "content is empty" });
    expect(canvas.parseFrame({ format: "ascii", content: "x".repeat(canvas.MAX_CONTENT + 1) })).toEqual({ error: expect.stringContaining("longer than") });
  });

  it("keeps frames per terminal, newest last, capped, and tells listeners", () => {
    const seen: [string, number][] = [];
    const off = canvas.onCanvasChanged((termId, frames) => seen.push([termId, frames.length]));
    for (let i = 0; i < canvas.MAX_FRAMES + 2; i++) {
      const parsed = canvas.parseFrame({ format: "ascii", title: `frame ${i}`, content: `#${i}` }, i);
      if ("frame" in parsed) canvas.addFrame("term-a", parsed.frame);
    }
    const other = canvas.parseFrame({ format: "markdown", content: "- one" });
    if ("frame" in other) canvas.addFrame("term-b", other.frame);
    const a = canvas.getFrames("term-a");
    expect(a).toHaveLength(canvas.MAX_FRAMES);
    expect(a[0].title).toBe("frame 2");
    expect(a[a.length - 1].title).toBe(`frame ${canvas.MAX_FRAMES + 1}`);
    expect(canvas.getFrames("term-b")).toHaveLength(1);
    expect(seen.at(-1)).toEqual(["term-b", 1]);
    expect(canvas.clearFrames("term-a")).toEqual([]);
    expect(canvas.getFrames("term-a")).toEqual([]);
    expect(seen.at(-1)).toEqual(["term-a", 0]);
    off();
    canvas.clearFrames("term-b");
    expect(seen.at(-1)).toEqual(["term-a", 0]);
    // Clearing an empty canvas is not a change anyone needs to hear about.
    canvas.onCanvasChanged(() => { throw new Error("unexpected"); });
    expect(canvas.clearFrames("term-c")).toEqual([]);
  });

  it("installs a canvas skill that posts to the canvas endpoint of the terminal's deck", () => {
    expect(SKILLS["deck-canvas"]).toContain("name: deck-canvas");
    expect(SKILLS["deck-canvas"]).toContain('/api/canvas?format=mermaid');
    expect(SKILLS["deck-canvas"]).toContain('-H "x-deck-term: $DECK_TERM_ID"');
    expect(SKILLS["deck-canvas"]).toContain("${DECK_PORT:-47800}");
    expect(SKILLS["deck-review"]).toContain("/api/review");
  });
});
