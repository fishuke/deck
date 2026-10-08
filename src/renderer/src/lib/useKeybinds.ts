/** Marks the element that is recording a new shortcut; global handlers skip
 *  keystrokes aimed at it so pressing a bound chord rebinds instead of firing. */
export const RECORDING_ATTRIBUTE = "data-recording-keys";

export function isRecordingKeys(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLElement && event.target.closest(`[${RECORDING_ATTRIBUTE}]`) !== null;
}

/** Whether a keystroke is aimed at somewhere text is being entered, including
 *  the hidden textarea xterm reads the terminal from. Single-key shortcuts
 *  check this so they never swallow a character the user meant to type. */
export function isTyping(event: KeyboardEvent): boolean {
  return ["TEXTAREA", "INPUT", "SELECT"].includes((event.target as HTMLElement)?.tagName ?? "");
}
