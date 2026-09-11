// Installs the built app into /Applications, so the Deck you use day to day is
// this checkout. Quits a running Deck first and reopens it afterwards; the
// dev channel (Deck Dev) is untouched and keeps its own data.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, globSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.dirname(import.meta.dirname);
const [built] = globSync("dist/mac-*/Deck.app", { cwd: root }).map((p) => path.join(root, p));
if (!built) {
  console.error("No built app found. Run `npm run build && npx electron-builder --mac dir` first.");
  process.exit(1);
}

const target = "/Applications/Deck.app";
const running = execSync(`pgrep -f '${target}/Contents/MacOS/Deck' || true`).toString().trim() !== "";
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (running) {
  execFileSync("osascript", ["-e", 'tell application "Deck" to quit']);
  // Give it a moment to release its port and PTY socket before the swap.
  execSync("for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f 'Deck.app/Contents/MacOS/Deck' >/dev/null || break; sleep 0.5; done");
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true });
run(`cp -R '${built}' /Applications/`);
// Editing or copying the bundle invalidates any signature; unsigned binaries
// won't launch on Apple Silicon, and the quarantine flag would prompt.
run(`codesign --force --deep --sign - '${target}'`);
run(`xattr -dr com.apple.quarantine '${target}' || true`);
console.log(`installed ${path.relative(root, built)} to ${target}`);

if (running) run(`open -a '${target}'`);
