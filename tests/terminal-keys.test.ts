import { describe, expect, it } from "vitest";
import { macEditingInput, type TerminalKeyPress } from "../src/shared/terminalKeys.js";

const press = (key: string, modifiers: Partial<TerminalKeyPress> = {}): TerminalKeyPress =>
  ({ type: "keydown", key, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...modifiers });

describe("macEditingInput", () => {
  it("moves by word with Option and an arrow, as Terminal.app does", () => {
    expect(macEditingInput(press("ArrowLeft", { altKey: true }))).toBe("\x1bb");
    expect(macEditingInput(press("ArrowRight", { altKey: true }))).toBe("\x1bf");
  });

  it("goes to the ends of the line with Command and an arrow", () => {
    expect(macEditingInput(press("ArrowLeft", { metaKey: true }))).toBe("\x1bOH");
    expect(macEditingInput(press("ArrowRight", { metaKey: true }))).toBe("\x1bOF");
  });

  it("clears the line with Command and Backspace", () => {
    expect(macEditingInput(press("Backspace", { metaKey: true }))).toBe("\x15");
  });

  it("leaves plain arrows, other modifiers and key releases to xterm", () => {
    expect(macEditingInput(press("ArrowLeft"))).toBeUndefined();
    expect(macEditingInput(press("ArrowLeft", { altKey: true, shiftKey: true }))).toBeUndefined();
    expect(macEditingInput(press("ArrowLeft", { metaKey: true, altKey: true }))).toBeUndefined();
    expect(macEditingInput(press("ArrowLeft", { ctrlKey: true }))).toBeUndefined();
    expect(macEditingInput({ ...press("ArrowLeft", { altKey: true }), type: "keyup" })).toBeUndefined();
    expect(macEditingInput(press("Backspace"))).toBeUndefined();
  });
});
