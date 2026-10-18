// The OS deck runs on, readable from the main process and the renderer alike:
// the renderer has navigator but no process, and main has process (and, on
// recent Node, a navigator that reports the same thing).

const platformName = (globalThis as { process?: { platform?: string } }).process?.platform
  ?? (globalThis as { navigator?: { platform?: string } }).navigator?.platform
  ?? "";

export const isMac = /^(darwin|Mac)/.test(platformName);
export const isWindows = /^(win32|Win)/.test(platformName);

/** Quotes one argument for the shell deck's terminals run: POSIX single
 *  quotes, or PowerShell's, where a quote is escaped by doubling it. */
export function shellQuote(text: string, windows = isWindows): string {
  return windows ? `'${text.replaceAll("'", "''")}'` : `'${text.replaceAll("'", "'\"'\"'")}'`;
}

/** Like shellQuote, but leaves plain words and paths as they are. */
export function shellArg(text: string, windows = isWindows): string {
  return (windows ? /[^\w./\\:-]/ : /[^\w./-]/).test(text) ? shellQuote(text, windows) : text;
}

/** The last segment of a path in either separator style. */
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
