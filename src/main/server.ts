import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { handleMcp, type JsonRpc } from "./orchestrator.js";
import { reviewTools } from "./review.js";
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
