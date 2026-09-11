import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/shared/settings.js";
import { FALLBACK_FONT, fontStack, fontWeight, letterSpacing, terminalOptions } from "../src/shared/terminal.js";

describe("terminal appearance", () => {
  it("follows the platform monospace when no family is set", () => {
    expect(fontStack("")).toBe(FALLBACK_FONT);
    expect(fontStack("   ")).toBe(FALLBACK_FONT);
  });

  it("quotes a family whose name contains spaces, and keeps the fallback last", () => {
    expect(fontStack("FiraCode Nerd Font")).toBe(`"FiraCode Nerd Font", ${FALLBACK_FONT}`);
    expect(fontStack("Menlo")).toBe(`Menlo, ${FALLBACK_FONT}`);
    expect(fontStack('"Already Quoted"')).toBe(`"Already Quoted", ${FALLBACK_FONT}`);
  });

  it("keeps a stack the user wrote, in order", () => {
    expect(fontStack("FiraCode Nerd Font, Menlo")).toBe(`"FiraCode Nerd Font", Menlo, ${FALLBACK_FONT}`);
  });

  it("takes the weights xterm understands and falls back on the rest", () => {
    expect(fontWeight("bold", "normal")).toBe("bold");
    expect(fontWeight("500", "normal")).toBe(500);
    expect(fontWeight("heavy", "normal")).toBe("normal");
    expect(fontWeight("1200", "bold")).toBe("bold");
    expect(fontWeight("", "normal")).toBe("normal");
  });

  it("clamps a size or line height that would break the layout", () => {
    expect(terminalOptions({ ...defaultSettings.terminalAppearance, fontSize: 400 }).fontSize).toBe(32);
    expect(terminalOptions({ ...defaultSettings.terminalAppearance, fontSize: 0 }).fontSize).toBe(8);
    expect(terminalOptions({ ...defaultSettings.terminalAppearance, fontSize: 12.6 }).fontSize).toBe(13);
    expect(terminalOptions({ ...defaultSettings.terminalAppearance, lineHeight: 9 }).lineHeight).toBe(2);
    expect(terminalOptions({ ...defaultSettings.terminalAppearance, lineHeight: Number.NaN }).lineHeight).toBe(1);
  });

  it("rounds letter spacing to whole pixels and clamps what xterm would not take", () => {
    expect(letterSpacing(1.4)).toBe(1);
    expect(letterSpacing(-1.5)).toBe(-1);
    expect(letterSpacing(99)).toBe(10);
    expect(letterSpacing(-99)).toBe(-5);
    expect(letterSpacing(Number.NaN)).toBe(0);
  });

  it("resolves the shipped defaults to deck's original terminal", () => {
    expect(terminalOptions(defaultSettings.terminalAppearance)).toEqual({
      fontFamily: FALLBACK_FONT, fontSize: 13, fontWeight: "normal", fontWeightBold: "bold",
      lineHeight: 1, letterSpacing: 0, cursorBlink: true, cursorStyle: "block",
    });
  });
});
