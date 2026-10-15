/** The environment a terminal's login shell starts from. Deck inherits its
 *  own from whatever launched it, which in dev mode is another shell. */

const droppedNames = new Set([
  // Deck itself may have been launched from inside a Claude Code session
  // (dev mode); its CLAUDE* markers would make claude in this terminal
  // think it's a child session and disable transcript saving.
  "CODEX_THREAD_ID", "CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "DECK_TERM_ID",
  // The launching shell's editor is not the system's: Terminal.app starts a
  // login shell without one and lets the profile set it. zsh switches every
  // terminal to the vi keymap when either of these names vi, so a leaked
  // value changes how the prompt reacts to keys.
  "EDITOR", "VISUAL",
]);

export function terminalEnv(processEnv: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(processEnv).filter(
      (entry): entry is [string, string] => !entry[0].startsWith("CLAUDE") && !droppedNames.has(entry[0]) && entry[1] !== undefined,
    ),
  );
}
