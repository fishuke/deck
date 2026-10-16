import { describe, expect, it } from "vitest";
import { parseForegroundCommands, ttyName } from "../src/main/ptyForeground.js";

const ps = [
  " 7643  7643 7763 ttys036  /bin/zsh -l",
  " 7763  7763 7763 ttys036  claude",
  " 7840  7763 7763 ttys036  npm exec chrome-devtools-mcp@1.9.0  ",
  "81449 81449 81679 ttys040  /bin/zsh -l",
  "81679 81679 81679 ttys040  caffeinate -d",
  "  587   587  587 ttys046  /bin/zsh -l",
  "",
].join("\n");

describe("parseForegroundCommands", () => {
  it("picks the leader of each tty's foreground process group", () => {
    const commands = parseForegroundCommands(ps);
    expect(commands.get("ttys040")).toEqual({ pid: 81679, command: "caffeinate -d" });
    expect(commands.get("ttys036")).toEqual({ pid: 7763, command: "claude" });
  });

  it("reports the shell itself when the tty sits at a prompt", () => {
    expect(parseForegroundCommands(ps).get("ttys046")).toEqual({ pid: 587, command: "/bin/zsh -l" });
  });

  it("trims the trailing padding ps leaves after the arguments", () => {
    expect(parseForegroundCommands("12 12 12 pts/3  npm run dev   \n").get("pts/3")?.command).toBe("npm run dev");
  });

  it("ignores lines that are not process rows", () => {
    expect(parseForegroundCommands("  PID  PGID TPGID TTY ARGS\n")).toEqual(new Map());
  });
});

describe("ttyName", () => {
  it("matches a pty's device path to the tty column", () => {
    expect(ttyName("/dev/ttys040")).toBe("ttys040");
    expect(ttyName("/dev/pts/3")).toBe("pts/3");
  });
});
