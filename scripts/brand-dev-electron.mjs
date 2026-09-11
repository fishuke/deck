// Dev mode runs the stock Electron.app from node_modules, so macOS shows
// "Electron" in the dock and Cmd-Tab. Rebrand that bundle in place: bundle
// name, plist name, icon, and an ad-hoc re-sign (editing Info.plist breaks the
// original signature, and unsigned binaries won't launch on Apple Silicon).
// The dock labels from the bundle's folder name, so the .app is renamed too
// and electron's path.txt repointed at it.
// Runs on postinstall; a fresh `yarn install` restores stock Electron first.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.platform !== "darwin") process.exit(0);

const root = path.dirname(import.meta.dirname);
const { build } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// The name src/main/devChannel.ts derives too, from the same field.
const NAME = `${build.productName} Dev`;
// Bundle names a previous run of this script (or a fresh install) left behind.
const PREVIOUS = ["Electron", build.productName];
const distDir = path.join(root, "node_modules/electron/dist");
const appDir = path.join(distDir, `${NAME}.app`);
const staleDir = PREVIOUS.map((name) => path.join(distDir, `${name}.app`)).find(existsSync);
const icns = path.join(root, "resources/icon.icns");

if (!existsSync(icns) || (!staleDir && !existsSync(appDir))) process.exit(0);

if (staleDir) renameSync(staleDir, appDir);
const executable = `${NAME}.app/Contents/MacOS/Electron`;
// No trailing newline: electron's index.js uses this verbatim as the path.
writeFileSync(path.join(distDir, "..", "path.txt"), executable);

const plist = path.join(appDir, "Contents/Info.plist");
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
  run(`/usr/libexec/PlistBuddy -c 'Set :${key} ${NAME}' '${plist}'`);
}
copyFileSync(icns, path.join(appDir, "Contents/Resources/electron.icns"));
run(`codesign --force --deep --sign - '${appDir}'`);
// LaunchServices caches the bundle icon by path; without a re-register the
// dock and Cmd-Tab keep showing the stock Electron icon.
run(`touch '${appDir}'`);
run(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f '${appDir}'`);
console.log(`branded dev Electron.app as ${NAME}`);
