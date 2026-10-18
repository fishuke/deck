import { afterEach, describe, expect, it, vi } from "vitest";
import { baseName, shellArg, shellQuote } from "../src/shared/platform.js";
import { formatAccelerator, formatChord } from "../src/shared/keybinds.js";
import { reportedCwd } from "../src/main/ptyCwd.js";
import { unwrapCmdShim } from "../src/main/userShell.js";

describe("shell quoting", () => {
  it("quotes for POSIX shells", () => {
    expect(shellQuote("it's", false)).toBe(`'it'"'"'s'`);
    expect(shellArg("src/app", false)).toBe("src/app");
    expect(shellArg("My Projects", false)).toBe("'My Projects'");
  });

  it("quotes for PowerShell by doubling single quotes", () => {
    expect(shellQuote("it's", true)).toBe("'it''s'");
    expect(shellArg("C:\\Users\\me\\deck", true)).toBe("C:\\Users\\me\\deck");
    expect(shellArg("C:\\My Projects\\$app", true)).toBe("'C:\\My Projects\\$app'");
  });
});

describe("baseName", () => {
  it("takes the last segment in either separator style", () => {
    expect(baseName("/Users/me/www/deck")).toBe("deck");
    expect(baseName("C:\\Users\\me\\deck\\")).toBe("deck");
  });
});

describe("formatting off the Mac", () => {
  it("spells chords and accelerators out", () => {
    expect(formatChord("Ctrl+Shift+Enter", false)).toBe("Ctrl+Shift+Enter");
    expect(formatChord("Alt+Digit1", false)).toBe("Alt+1");
    expect(formatAccelerator("Alt+Space", false)).toBe("Alt+Space");
    expect(formatAccelerator("CommandOrControl+Shift+Space", false)).toBe("Ctrl+Shift+Space");
  });
});

describe("Windows default keybinds", () => {
  const platform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.resetModules();
  });

  it("are unique and leave plain Ctrl letters and AltGr to the shell", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.resetModules();
    const { defaultKeybinds } = await import("../src/shared/keybinds.js");
    const chords = Object.values(defaultKeybinds);
    expect(new Set(chords).size).toBe(chords.length);
    expect(chords.some((chord) => chord.startsWith("Meta") || chord.startsWith("Ctrl+Alt"))).toBe(false);
    // Ctrl+<letter> belongs to the shell (^C, ^D, ^W, ^R …).
    expect(chords.filter((chord) => /^Ctrl\+[A-Z]$/.test(chord))).toEqual([]);
  });
});

describe("reportedCwd", () => {
  it("reads the folder PowerShell reports with OSC 9;9", () => {
    expect(reportedCwd(`\x1b]9;9;"C:\\Users\\me"\x07PS C:\\Users\\me> `)).toBe("C:\\Users\\me");
    expect(reportedCwd(`\x1b]9;9;"C:\\a"\x07\r\n\x1b]9;9;"C:\\b"\x1b\\`)).toBe("C:\\b");
    expect(reportedCwd("plain output")).toBeUndefined();
  });
});

describe("unwrapCmdShim", () => {
  it("runs the script an npm shim points at with node", () => {
    const shim = `@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n`;
    expect(unwrapCmdShim("C:\\npm\\claude.cmd", shim)).toEqual({ file: "node", args: ["C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"] });
  });

  it("gives up on a shim it does not recognise", () => {
    expect(unwrapCmdShim("C:\\bin\\tool.cmd", "@echo off\r\ntool.exe %*")).toBeUndefined();
  });
});
