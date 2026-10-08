import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { handleMcp, type JsonRpc } from "./orchestrator.js";
import { reviewTools } from "./review.js";
import { addFrame, clearFrames, getFrames, parseFrame, updateFrame } from "./canvas.js";
import { SERVER_PORT } from "./port.js";
import { applyHook, requestReview, type HookPayload } from "./sessions.js";

// deck's local HTTP surface: Claude Code hooks curl into it and deck's own
// assistants reach their MCP tools through it. Loopback only.

let server: ServerType | undefined;

function buildApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/hook", async (c) => {
    const payload = (await c.req.json().catch(() => ({}))) as HookPayload;
    applyHook(payload, c.req.header("x-deck-term") || null, c.req.header("x-deck-agent") === "codex" ? "codex" : "claude");
    return c.json({ ok: true });
  });

  // The deck-review skill posts the agent's decisions summary as plain text
  // when it pauses for user verification before pushing.
  app.post("/api/review", async (c) => {
    const term = c.req.header("x-deck-term");
    const note = (await c.req.text().catch(() => "")).trim();
    if (term && note) requestReview(term, note);
    return c.json({ ok: Boolean(term && note) });
  });

  // The deck-canvas skill posts a drawing for the terminal's canvas panel:
  // JSON ({ title, format, content, ... }), or the raw drawing as the body
  // with the format and title in the query or headers, so an svg or a page
  // needs no escaping on the way in. The title names the tab; a title already
  // on the canvas is replaced rather than added.
  app.post("/api/canvas", async (c) => {
    const term = c.req.header("x-deck-term");
    if (!term) return c.json({ ok: false, error: "x-deck-term header missing" }, 400);
    const isJson = (c.req.header("content-type") ?? "").includes("application/json");
    const input = isJson
      ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
      : {
          content: await c.req.text().catch(() => ""),
          format: c.req.query("format") ?? c.req.header("x-deck-format"),
          title: c.req.query("title") ?? c.req.header("x-deck-title"),
          language: c.req.query("language") ?? c.req.header("x-deck-language"),
          alt: c.req.query("alt") ?? c.req.header("x-deck-alt"),
        };
    const parsed = parseFrame(input);
    if ("error" in parsed) return c.json({ ok: false, error: parsed.error }, 400);
    const frames = addFrame(term, parsed.frame);
    return c.json({ ok: true, id: parsed.frame.id, frames: frames.length });
  });
  app.get("/api/canvas", (c) => {
    const term = c.req.header("x-deck-term");
    if (!term) return c.json({ ok: false, error: "x-deck-term header missing" }, 400);
    return c.json({ ok: true, frames: getFrames(term) });
  });
  // Rewrites one frame in place (a progress list the agent keeps current).
  app.put("/api/canvas/:id", async (c) => {
    const term = c.req.header("x-deck-term");
    if (!term) return c.json({ ok: false, error: "x-deck-term header missing" }, 400);
    const content = await c.req.text().catch(() => "");
    const frames = updateFrame(term, c.req.param("id"), content);
    return frames ? c.json({ ok: true }) : c.json({ ok: false, error: "no such frame, or empty content" }, 404);
  });
  app.delete("/api/canvas", (c) => {
    const term = c.req.header("x-deck-term");
    if (!term) return c.json({ ok: false, error: "x-deck-term header missing" }, 400);
    clearFrames(term);
    return c.json({ ok: true });
  });

  // The agent page's assistant reaches deck's tools here (MCP over HTTP with
  // plain JSON responses). Loopback only, like everything else on this server.
  app.post("/api/mcp", async (c) => {
    const message = (await c.req.json().catch(() => null)) as JsonRpc | null;
    if (!message?.method) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    const { status, body } = await handleMcp(message);
    return body === undefined ? c.body(null, 202) : c.json(body, status as 200);
  });
  app.get("/api/mcp", (c) => c.body(null, 405));
  app.delete("/api/mcp", (c) => c.body(null, 200));

  // The review assistant of one PR gets tools bound to that PR, so its draft
  // comments can only land on the review it belongs to.
  app.post("/api/mcp/review/:owner/:name/:number", async (c) => {
    const message = (await c.req.json().catch(() => null)) as JsonRpc | null;
    if (!message?.method) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    const { owner, name, number } = c.req.param();
    const { status, body } = await handleMcp(message, reviewTools(`${owner}/${name}`, Number(number)));
    return body === undefined ? c.body(null, 202) : c.json(body, status as 200);
  });
  app.get("/api/mcp/review/:owner/:name/:number", (c) => c.body(null, 405));
  app.delete("/api/mcp/review/:owner/:name/:number", (c) => c.body(null, 200));

  return app;
}

export const MCP_URL = `http://127.0.0.1:${SERVER_PORT}/api/mcp`;

export function startServer(attempt = 0): void {
  const app = buildApp();
  server = serve({ fetch: app.fetch, port: SERVER_PORT, hostname: "127.0.0.1" });
  // Dev watch-restarts overlap with the old instance for a moment; retry
  // until the previous process releases the port.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attempt < 10) {
      server?.close();
      setTimeout(() => startServer(attempt + 1), 500);
    }
  });
}

export function stopServer(): void {
  server?.close();
  server = undefined;
}
