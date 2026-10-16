import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// node-pty names the program holding a terminal, but only by its process
// name. The tab wants the whole command line ("caffeinate -d", not
// "caffeinate"), which ps knows: the foreground job of a tty is the process
// group the tty reports (tpgid), and its leader is the command the user typed.

export interface ForegroundCommand {
  pid: number;
  command: string;
}

/** Parses `ps -o pid=,pgid=,tpgid=,tty=,args=` into the foreground command of each tty. */
export function parseForegroundCommands(output: string): Map<string, ForegroundCommand> {
  const commands = new Map<string, ForegroundCommand>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, pid, pgid, tpgid, tty, command] = match;
    // The group leader of the tty's foreground group is the command itself;
    // the rest of the group is whatever it spawned.
    if (pid !== pgid || pgid !== tpgid || !command) continue;
    commands.set(tty, { pid: Number(pid), command });
  }
  return commands;
}

/** Drops the /dev/ prefix so a pty's name matches the tty column ps prints. */
export function ttyName(ptsName: string): string {
  return ptsName.replace(/^\/dev\//, "");
}

export async function readForegroundCommands(ttys: string[]): Promise<Map<string, ForegroundCommand>> {
  if (!ttys.length) return new Map();
  // ps exits non-zero when a tty has no processes, but still prints the rest.
  const { stdout } = await exec("ps", ["-o", "pid=,pgid=,tpgid=,tty=,args=", "-t", ttys.join(",")])
    .catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
  return parseForegroundCommands(stdout);
}
