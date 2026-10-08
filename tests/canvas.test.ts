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

  it("keeps one tab per title, replaces a reposted title, drops the tab touched longest ago, and tells listeners", () => {
    const seen: [string, number][] = [];
    const off = canvas.onCanvasChanged((termId, frames) => seen.push([termId, frames.length]));
    const add = (termId: string, title: string, content: string, at: number) => {
      const parsed = canvas.parseFrame({ format: "markdown", title, content }, at);
      if (!("frame" in parsed)) throw new Error(parsed.error);
      return canvas.addFrame(termId, parsed.frame);
    };
    add("term-a", "Now", "- [ ] start", 1);
    add("term-a", "Flow", "a -> b", 2);
    const replaced = add("term-a", " now ", "- [x] start\n- [ ] next", 3);
    expect(replaced.map((frame) => frame.title)).toEqual(["Now", "Flow"]);
    expect(replaced[0]).toMatchObject({ title: "Now", content: "- [x] start\n- [ ] next", createdAt: 1, updatedAt: 3 });
    expect(replaced[0].id).toBe(canvas.getFrames("term-a")[0].id);
    for (let i = 0; i < canvas.MAX_FRAMES; i++) add("term-a", `tab ${i}`, `#${i}`, 10 + i);
    const a = canvas.getFrames("term-a");
    expect(a).toHaveLength(canvas.MAX_FRAMES);
    expect(a.map((frame) => frame.title)).not.toContain("Now");
    expect(a.map((frame) => frame.title)).not.toContain("Flow");
    expect(a.at(-1)?.title).toBe(`tab ${canvas.MAX_FRAMES - 1}`);
    add("term-b", "Plan", "- one", 50);
    expect(canvas.getFrames("term-b")).toHaveLength(1);
    expect(seen.at(-1)).toEqual(["term-b", 1]);
    const removed = canvas.removeFrame("term-a", a[0].id);
    expect(removed).toHaveLength(canvas.MAX_FRAMES - 1);
    expect(canvas.removeFrame("term-a", "missing")).toHaveLength(canvas.MAX_FRAMES - 1);
    expect(canvas.clearFrames("term-a")).toEqual([]);
    expect(seen.at(-1)).toEqual(["term-a", 0]);
    off();
    canvas.clearFrames("term-b");
    expect(seen.at(-1)).toEqual(["term-a", 0]);
    // Clearing an empty canvas is not a change anyone needs to hear about.
    const offStrict = canvas.onCanvasChanged(() => { throw new Error("unexpected"); });
    expect(canvas.clearFrames("term-c")).toEqual([]);
    offStrict();
  });

  it("updates a frame in place and flips task items by source line", () => {
    const parsed = canvas.parseFrame({ format: "markdown", title: "Todo", content: "## Plan\n- [ ] tokens\n- [x] toggle\n1. [ ] remember" });
    if (!("frame" in parsed)) throw new Error(parsed.error);
    canvas.addFrame("term-t", parsed.frame);
    expect(canvas.toggleTask(parsed.frame.content, 2)).toBe("## Plan\n- [x] tokens\n- [x] toggle\n1. [ ] remember");
    expect(canvas.toggleTask(parsed.frame.content, 3)).toBe("## Plan\n- [ ] tokens\n- [ ] toggle\n1. [ ] remember");
    expect(canvas.toggleTask(parsed.frame.content, 4)).toBe("## Plan\n- [ ] tokens\n- [x] toggle\n1. [x] remember");
    expect(canvas.toggleTask(parsed.frame.content, 1)).toBe(parsed.frame.content);
    expect(canvas.toggleTask(parsed.frame.content, 9)).toBe(parsed.frame.content);
    const updated = canvas.updateFrame("term-t", parsed.frame.id, canvas.toggleTask(parsed.frame.content, 2));
    expect(updated?.[0].content).toContain("- [x] tokens");
    expect(updated?.[0].updatedAt).toBeGreaterThanOrEqual(updated?.[0].createdAt ?? 0);
    expect(canvas.getFrames("term-t")[0]).toMatchObject({ id: parsed.frame.id, title: "Todo" });
    expect(canvas.updateFrame("term-t", "missing", "x")).toBeUndefined();
    expect(canvas.updateFrame("term-t", parsed.frame.id, "  ")).toBeUndefined();
  });

  it("installs a canvas skill that posts to the canvas endpoint of the terminal's deck", () => {
    expect(SKILLS["deck-canvas"]).toContain("name: deck-canvas");
    expect(SKILLS["deck-canvas"]).toContain('/api/canvas?format=markdown');
    expect(SKILLS["deck-canvas"]).toContain("- [ ]");
    expect(SKILLS["deck-canvas"]).toContain('-H "x-deck-term: $DECK_TERM_ID"');
    expect(SKILLS["deck-canvas"]).toContain("${DECK_PORT:-47800}");
    expect(SKILLS["deck-review"]).toContain("/api/review");
  });
});
