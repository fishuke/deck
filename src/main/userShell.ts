import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { isWindows } from "../shared/platform.js";

const exec = promisify(execFile);

// The shell deck's terminals run and the way main runs commands "as the user
// would": a login shell on macOS and Linux, PowerShell on Windows.

/** PowerShell 7 when installed, else the Windows PowerShell every Windows has. */
function windowsShell(): string {
  const pwsh = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
  return fs.existsSync(pwsh) ? pwsh : "powershell.exe";
}

export const userShell: string = isWindows ? windowsShell() : process.env.SHELL ?? "/bin/zsh";

// PowerShell has no way to tell a terminal its folder, so the prompt is
// wrapped to report it with the OSC 9;9 sequence Windows Terminal reads.
const REPORT_CWD = "$__deckPrompt = $function:prompt; function global:prompt { \"$([char]27)]9;9;`\"$($PWD.ProviderPath)`\"$([char]7)\" + (& $__deckPrompt) }";

/** Arguments that start the user's shell, running `command` first when given
 *  and dropping back to a prompt when it exits. */
export function shellArgs(command?: string): string[] {
  if (isWindows) return ["-NoLogo", "-NoExit", "-Command", command ? `${REPORT_CWD}; ${command}` : REPORT_CWD];
  // A command still runs inside a login shell so PATH and profile apply.
  return command ? ["-l", "-i", "-c", `${command}; exec ${userShell} -l`] : ["-l"];
}

/** Runs a command the way the user's own prompt would, so version managers apply. */
export async function runInUserShell(command: string, options: { cwd?: string; timeout: number }): Promise<string> {
  const args = isWindows ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] : ["-lc", command];
  const { stdout } = await exec(userShell, args, { ...options, windowsHide: true });
  return stdout;
}

export interface ResolvedCommand {
  file: string;
  /** Arguments that go before the caller's own, e.g. the script an npm shim runs. */
  args: string[];
}

/** npm installs CLIs on Windows as .cmd shims, which Node cannot spawn
 *  without a shell, and cmd.exe cannot pass multi-line arguments. The shim
 *  only runs node on a script, so that is run directly instead. */
export function unwrapCmdShim(shim: string, contents: string): ResolvedCommand | undefined {
  const script = /"%~?dp0%\\?([^"]+\.[cm]?js)"/i.exec(contents)?.[1];
  if (!script) return undefined;
  const dir = path.win32.dirname(shim);
  const bundledNode = path.win32.join(dir, "node.exe");
  return { file: fs.existsSync(bundledNode) ? bundledNode : "node", args: [path.win32.join(dir, script)] };
}

const resolved = new Map<string, Promise<ResolvedCommand>>();

/** A packaged app on macOS inherits a bare PATH, so a CLI is resolved the way
 *  the user's own shell would resolve it. */
export function resolveCommand(name: string): Promise<ResolvedCommand> {
  let found = resolved.get(name);
  if (!found) {
    found = isWindows
      ? exec("where.exe", [name], { timeout: 10_000, windowsHide: true }).then(({ stdout }) => {
          const candidates = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          const exe = candidates.find((file) => /\.exe$/i.test(file));
          if (exe) return { file: exe, args: [] };
          const shim = candidates.find((file) => /\.cmd$/i.test(file));
          return (shim && unwrapCmdShim(shim, fs.readFileSync(shim, "utf8"))) || { file: name, args: [] };
        })
      : runInUserShell(`command -v ${name}`, { timeout: 10_000 }).then((stdout) => ({ file: stdout.trim().split("\n").pop() || name, args: [] }));
    found = found.catch(() => ({ file: name, args: [] }));
    resolved.set(name, found);
  }
  return found;
}
