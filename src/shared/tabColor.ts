// Tab color an application sets over OSC 6, iTerm2's extension. Claude Code
// tints its tab per state through it, and any tool emitting the sequence gets
// the same treatment. The three channels arrive as separate sequences, so a
// color is only complete once all of them have been seen.

export interface TabColorChannels { red?: number; green?: number; blue?: number }

const CHANNEL = /^1;bg;(red|green|blue);brightness;(\d{1,3})$/;
const RESET = /^1;bg;\*;default$/;

const hex = (value: number): string => value.toString(16).padStart(2, "0");

/** Folds one OSC 6 payload into the channels seen so far. `color` is the css
 *  color once all three channels are known, null to clear, and absent while
 *  the color is still incomplete or the payload is one we do not handle. */
export function applyTabColor(channels: TabColorChannels, payload: string): { channels: TabColorChannels; color?: string | null } {
  if (RESET.test(payload)) return { channels: {}, color: null };
  const match = CHANNEL.exec(payload);
  if (!match) return { channels };
  const channel = match[1] as keyof TabColorChannels;
  const next = { ...channels, [channel]: Math.min(255, Number(match[2])) };
  const { red, green, blue } = next;
  if (red === undefined || green === undefined || blue === undefined) return { channels: next };
  return { channels: next, color: `#${hex(red)}${hex(green)}${hex(blue)}` };
}
