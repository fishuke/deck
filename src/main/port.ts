// deck's local HTTP port, where agent hooks report and deck's own assistants
// reach their MCP tools. A dev run listens one port up, so it never collides
// with the installed app.
//
// Electron sets defaultApp when it was started with a script instead of from
// a packaged bundle — the same signal as app.isPackaged, but without pulling
// electron into the modules that need the port (the tests import them
// directly, outside Electron).
export const DEFAULT_SERVER_PORT = 47800;
export const SERVER_PORT = process.defaultApp ? DEFAULT_SERVER_PORT + 1 : DEFAULT_SERVER_PORT;
