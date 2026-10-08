export type TerminalAction = "find" | "clear" | "export" | "files" | "changes" | "canvas" | "split-right" | "split-down" | "focus" | "composer";
const EVENT = "deck:terminal-action";
export function terminalAction(action: TerminalAction): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: action }));
}
export function onTerminalAction(callback: (action: TerminalAction) => void): () => void {
  const listener = (event: Event) => callback((event as CustomEvent<TerminalAction>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
