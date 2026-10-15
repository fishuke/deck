/** Line-editing chords a Mac user expects at a prompt, resolved to the bytes
 *  the pty gets. xterm either drops them (⌘ with an arrow sends nothing) or
 *  encodes them in a form shells leave unbound (with macOptionIsMeta, ⌥← is
 *  ESC [1;3D; zsh does not bind it, and in vi insert mode the bare ESC
 *  switches to command mode, which reads as "the arrow keys are broken").
 *  Terminal.app and iTerm2 send the readline motions instead, so every shell
 *  and TUI understands them. Returns undefined to let xterm handle the key. */

export interface TerminalKeyPress { type: string; key: string; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean }

export function macEditingInput(event: TerminalKeyPress): string | undefined {
  if (event.type !== "keydown" || event.ctrlKey || event.shiftKey) return undefined;
  if (event.metaKey && !event.altKey) {
    // ⌘⌫ clears the line, as in Terminal.app and iTerm2; xterm would send a single delete.
    if (event.key === "Backspace") return "\x15";
    // ⌘← and ⌘→ are Home and End, in the terminfo form zsh binds for xterm (khome, kend).
    if (event.key === "ArrowLeft") return "\x1bOH";
    if (event.key === "ArrowRight") return "\x1bOF";
  }
  if (event.altKey && !event.metaKey) {
    // ⌥← and ⌥→ move by word: ESC b and ESC f, bound by every readline-style editor.
    if (event.key === "ArrowLeft") return "\x1bb";
    if (event.key === "ArrowRight") return "\x1bf";
  }
  return undefined;
}
