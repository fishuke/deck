import { describe, expect, it } from "vitest";
import { terminalEnv } from "../src/main/ptyEnv.js";

describe("terminalEnv", () => {
  it("drops the launching shell's editor so the login shell picks its own keymap", () => {
    expect(terminalEnv({ HOME: "/Users/me", EDITOR: "vi", VISUAL: "vim" })).toEqual({ HOME: "/Users/me" });
  });

  it("drops the markers of an enclosing agent session and of the launching terminal", () => {
    expect(terminalEnv({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CODEX_THREAD_ID: "t", DECK_TERM_ID: "x", SHELL: "/bin/zsh" })).toEqual({ SHELL: "/bin/zsh" });
  });

  it("keeps everything else and skips unset values", () => {
    expect(terminalEnv({ SSH_AUTH_SOCK: "/tmp/agent", LANG: undefined })).toEqual({ SSH_AUTH_SOCK: "/tmp/agent" });
  });
});
