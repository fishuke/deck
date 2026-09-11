import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// A dev run is its own channel, the way VS Code ships Insiders alongside
// stable: the distinct name gives it its own userData — database, settings,
// PTY socket, logs — plus its own dock and menu bar label, so the installed
// Deck stays open and in use while this one restarts. Dev mode also runs the
// stock Electron bundle, which would otherwise name the menu bar "Electron";
// the name here matches the bundle scripts/brand-dev-electron.mjs renames.
//
// This lives in its own module, imported first by index.ts, because modules
// read userData while they are being imported (autofix.ts opens the database
// for its module state) — before any statement in index.ts runs.

// A packaged build is already named by electron-builder.
if (!app.isPackaged) {
  const { build } = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
  app.setName(`${build.productName} Dev`);
}
// Electron creates the userData directory for the default app name only.
fs.mkdirSync(app.getPath("userData"), { recursive: true });
