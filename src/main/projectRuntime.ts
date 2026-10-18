import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWindows } from "../shared/platform.js";
import { runInUserShell } from "./userShell.js";

// The runtime a folder's project actually runs on, for the terminal's context
// bar. Resolved through a login shell so version managers (nvm, pyenv, asdf)
// pick the same version the user's own prompt would show.

export interface ProjectRuntime {
  /** Short runtime name, e.g. "node". */
  label: string;
  /** Version as the tool reports it, e.g. "v24.18.0". */
  version: string;
}

const shell = (command: string, cwd: string): Promise<string> => runInUserShell(command, { cwd, timeout: 5000 });

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const runtimes: { marker: string; label: string; command: string }[] = [
  { marker: "package.json", label: "node", command: "node --version" },
  // Windows installs python without the 3.
  { marker: "pyproject.toml", label: "python", command: isWindows ? "python --version" : "python3 --version" },
  { marker: "requirements.txt", label: "python", command: isWindows ? "python --version" : "python3 --version" },
  { marker: "Cargo.toml", label: "rust", command: "rustc --version" },
  { marker: "go.mod", label: "go", command: "go version" },
];

/** Runtime versions installed locally, and the manager that can switch them. */
export interface InstalledVersions {
  manager: string;
  versions: string[];
}

const cached = new Map<string, { expires: number; result: Promise<ProjectRuntime | null> }>();

export function projectRuntime(rawCwd: string): Promise<ProjectRuntime | null> {
  const cwd = expandHome(rawCwd);
  const hit = cached.get(cwd);
  if (hit && hit.expires > Date.now()) return hit.result;
  const runtime = runtimes.find((runtime) => fs.existsSync(path.join(cwd, runtime.marker)));
  const result = !runtime ? Promise.resolve(null) : shell(runtime.command, cwd)
    .then((stdout) => {
      const version = /\d[\d.]*/.exec(stdout)?.[0];
      return version ? { label: runtime.label, version: `v${version}` } : null;
    })
    .catch(() => null);
  cached.set(cwd, { expires: Date.now() + 60_000, result });
  return result;
}

// Only node has a switchable-version story worth a menu; nvm and fnm both
// take `<manager> use <version>`, and both must run in the user's shell.
const managers = ["nvm", "fnm"];

/**
 * Installed versions from an `nvm ls` / `fnm ls` listing, newest first. Only
 * lines that are a version on their own count: nvm's alias lines name versions
 * that are not installed at all (`lts/argon -> v4.9.1 (-> N/A)`).
 */
export function parseInstalledVersions(listing: string): string[] {
  const versions = listing.split("\n")
    .map((line) => /^(?:[->*\s])*(v\d+\.\d+\.\d+)\b/.exec(line.trim())?.[1])
    .filter((version): version is string => Boolean(version));
  return [...new Set(versions)].sort((a, b) => {
    const [left, right] = [a, b].map((version) => version.slice(1).split(".").map(Number));
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
}

// What is installed is a property of the machine, not of the folder, so one
// lookup serves every terminal.
let installed: Promise<InstalledVersions | null> | undefined;

export async function installedVersions(rawCwd: string): Promise<InstalledVersions | null> {
  const cwd = expandHome(rawCwd);
  if ((await projectRuntime(cwd))?.label !== "node") return null;
  installed ??= (async () => {
    for (const manager of managers) {
      const listed = await shell(`${manager} ls --no-colors --no-alias`, cwd).catch(() => "");
      const versions = parseInstalledVersions(listed);
      if (versions.length) return { manager, versions };
    }
    return null;
  })();
  return installed;
}
