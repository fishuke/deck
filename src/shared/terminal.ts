// Terminal appearance, resolved from settings into the options xterm takes.

export const FALLBACK_FONT = "ui-monospace, Menlo, monospace";
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 2;
export const MIN_LETTER_SPACING = -5;
export const MAX_LETTER_SPACING = 10;

export type CursorStyle = "block" | "underline" | "bar";
/** The weights xterm accepts: the two keywords, or a hundred from 100 to 900. */
export type FontWeightValue = "normal" | "bold" | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface TerminalAppearanceSettings {
  /** Font stack for the terminal; empty follows the platform monospace. */
  fontFamily: string;
  fontSize: number;
  /** "normal", "bold", or 100-900. */
  fontWeight: string;
  fontWeightBold: string;
  lineHeight: number;
  /** Extra pixels between characters; negative tightens. */
  letterSpacing: number;
  cursorBlink: boolean;
  cursorStyle: CursorStyle;
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Family names carrying spaces have to be quoted to survive as CSS, and the
 *  platform monospace stays on the end so a missing font still renders. */
export function fontStack(fontFamily: string): string {
  const families = fontFamily.split(",").map((name) => name.trim()).filter(Boolean);
  if (families.length === 0) return FALLBACK_FONT;
  const quoted = families.map((name) =>
    /\s/.test(name) && !/^['"].*['"]$/.test(name) ? `"${name}"` : name,
  );
  return [...quoted, FALLBACK_FONT].join(", ");
}

/** xterm accepts the two keywords or a hundred from 100 to 900; anything else
 *  would be dropped silently, so fall back rather than pass it on. */
export function fontWeight(weight: string, fallback: FontWeightValue): FontWeightValue {
  const trimmed = weight.trim();
  if (trimmed === "normal" || trimmed === "bold") return trimmed;
  const numeric = Number(trimmed);
  if (numeric >= 100 && numeric <= 900 && numeric % 100 === 0) return numeric as FontWeightValue;
  return fallback;
}

export function fontSize(size: number): number {
  return clamp(Math.round(size), MIN_FONT_SIZE, MAX_FONT_SIZE, 13);
}

export function lineHeight(height: number): number {
  return clamp(height, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT, 1);
}

/** xterm spaces characters in whole pixels; a fraction would be truncated. */
export function letterSpacing(spacing: number): number {
  return clamp(Math.round(spacing), MIN_LETTER_SPACING, MAX_LETTER_SPACING, 0);
}

/** Everything the terminal needs, with every value already made safe. */
export function terminalOptions(appearance: TerminalAppearanceSettings) {
  return {
    fontFamily: fontStack(appearance.fontFamily),
    fontSize: fontSize(appearance.fontSize),
    fontWeight: fontWeight(appearance.fontWeight, "normal"),
    fontWeightBold: fontWeight(appearance.fontWeightBold, "bold"),
    lineHeight: lineHeight(appearance.lineHeight),
    letterSpacing: letterSpacing(appearance.letterSpacing),
    cursorBlink: appearance.cursorBlink,
    cursorStyle: appearance.cursorStyle,
  };
}
