import { describe, expect, it } from "vitest";
import os from "node:os";
import pty from "node-pty";
import { reportedCwd } from "../src/main/ptyCwd.js";
import { resolveCommand, shellArgs, userShell } from "../src/main/userShell.js";

// Runs only on Windows (CI's windows-latest): the real PowerShell, through
// ConPTY, has to report its folder and run a command the way deck starts it.
describe.runIf(process.platform === "win32")("PowerShell terminals", () => {
  it("report their folder after a cd and run the launch command", async () => {
    const proc = pty.spawn(userShell, shellArgs("Write-Output deck-ready"), { cwd: os.homedir(), env: process.env as Record<string, string> });
    let output = "";
    const cwds: string[] = [];
    const seen = (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out; output so far: ${JSON.stringify(output)}`)), 20_000);
      const check = () => { if (predicate()) { clearTimeout(timer); resolve(); } };
      proc.onData(check);
      check();
    });
    proc.onData((data) => {
      output += data;
      const cwd = reportedCwd(data);
      if (cwd) cwds.push(cwd);
    });
    try {
      await seen(() => output.includes("deck-ready") && cwds.length > 0);
      expect(cwds[0].toLowerCase()).toBe(os.homedir().toLowerCase());
      proc.write(`cd ${process.env.SystemRoot ?? "C:\\Windows"}\r`);
      await seen(() => cwds.some((cwd) => /\\windows$/i.test(cwd)));
    } finally {
      proc.kill();
    }
  }, 30_000);

  it("resolve git to a program node can spawn", async () => {
    const git = await resolveCommand("git");
    expect(git.file).toMatch(/\.exe$/i);
  });
});
