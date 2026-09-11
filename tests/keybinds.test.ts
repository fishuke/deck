import { describe, expect, it } from "vitest";
import { acceleratorOf, chordOf, defaultKeybinds, formatAccelerator, formatChord, matchKeybind, resolveKeybinds } from "../src/shared/keybinds.js";

const press = (over: Partial<Parameters<typeof chordOf>[0]>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe("keybinds", () => {
  it("builds chords from the physical key so ⌥3 does not become £", () => {
    expect(chordOf(press({ key: "£", code: "Digit3", metaKey: true, altKey: true }))).toBe("Meta+Alt+Digit3");
    expect(chordOf(press({ key: "t", code: "KeyT", metaKey: true, shiftKey: true }))).toBe("Meta+Shift+T");
    expect(chordOf(press({ key: ",", code: "Comma", metaKey: true }))).toBe("Meta+,");
    expect(chordOf(press({ key: "Enter", code: "Enter", metaKey: true, shiftKey: true }))).toBe("Meta+Shift+Enter");
  });

  it("ignores bare modifier presses", () => {
    expect(chordOf(press({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeUndefined();
  });

  it("matches overrides over defaults", () => {
    const keybinds = resolveKeybinds({ search: "Ctrl+Space" });
    expect(matchKeybind(keybinds, press({ key: " ", code: "Space", ctrlKey: true }))).toBe("search");
    expect(matchKeybind(keybinds, press({ key: "k", code: "KeyK", metaKey: true }))).toBeUndefined();
    expect(matchKeybind(keybinds, press({ key: "w", code: "KeyW", metaKey: true }))).toBe("tab.close");
    expect(matchKeybind(keybinds, press({ key: "t", code: "KeyT", metaKey: true, shiftKey: true }))).toBe("tab.reopen");
    expect(matchKeybind(keybinds, press({ key: "n", code: "KeyN", metaKey: true, shiftKey: true }))).toBe("tab.newAgent");
    expect(matchKeybind(keybinds, press({ key: "n", code: "KeyN", metaKey: true }))).toBe("window.new");
  });

  it("matches the terminal text size chords, digits coming from the physical key", () => {
    const keybinds = resolveKeybinds({});
    expect(matchKeybind(keybinds, press({ key: "=", code: "Equal", metaKey: true }))).toBe("font.increase");
    expect(matchKeybind(keybinds, press({ key: "-", code: "Minus", metaKey: true }))).toBe("font.decrease");
    expect(matchKeybind(keybinds, press({ key: "0", code: "Digit0", metaKey: true }))).toBe("font.reset");
    // ⌘1-9 focus tabs; only ⌘0 is the size reset.
    expect(matchKeybind(keybinds, press({ key: "1", code: "Digit1", metaKey: true }))).toBeUndefined();
  });

  it("turns chords into electron accelerators", () => {
    expect(acceleratorOf("Meta+,")).toBe("CommandOrControl+,");
    expect(acceleratorOf("Meta+Alt+Digit2")).toBe("CommandOrControl+Alt+2");
    expect(acceleratorOf(defaultKeybinds.zen)).toBe("CommandOrControl+Shift+Return");
    expect(acceleratorOf("Ctrl+Tab")).toBe("Control+Tab");
    expect(acceleratorOf("F5")).toBeUndefined();
    expect(acceleratorOf(defaultKeybinds["font.increase"])).toBe("CommandOrControl+=");
    expect(acceleratorOf(defaultKeybinds["font.decrease"])).toBe("CommandOrControl+-");
    expect(acceleratorOf(defaultKeybinds["font.reset"])).toBe("CommandOrControl+0");
  });

  it("formats chords with mac symbols", () => {
    expect(formatChord(defaultKeybinds.zen)).toBe("⌘⇧⏎");
    expect(formatChord("Meta+Alt+Digit1")).toBe("⌘⌥1");
    expect(formatChord("Ctrl+Space")).toBe("⌃space");
    expect(formatChord(defaultKeybinds["font.increase"])).toBe("⌘=");
    expect(formatChord(defaultKeybinds["font.reset"])).toBe("⌘0");
  });

  it("formats the summon accelerator with mac symbols", () => {
    expect(formatAccelerator("Alt+Space")).toBe("⌥space");
    expect(formatAccelerator("CommandOrControl+Shift+Space")).toBe("⌘⇧space");
    expect(formatAccelerator(acceleratorOf("Meta+Alt+Digit1") ?? "")).toBe("⌘⌥1");
    expect(formatAccelerator("Control+Return")).toBe("⌃⏎");
  });
});
