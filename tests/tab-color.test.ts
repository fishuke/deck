import { describe, expect, it } from "vitest";
import { applyTabColor, type TabColorChannels } from "../src/shared/tabColor.js";

/** Folds a whole sequence of payloads, as a terminal would receive them. */
function feed(payloads: string[]): { channels: TabColorChannels; colors: (string | null)[] } {
  let channels: TabColorChannels = {};
  const colors: (string | null)[] = [];
  for (const payload of payloads) {
    const result = applyTabColor(channels, payload);
    channels = result.channels;
    if (result.color !== undefined) colors.push(result.color);
  }
  return { channels, colors };
}

describe("osc 6 tab color", () => {
  it("builds the color claude code emits, once every channel has arrived", () => {
    const { colors } = feed([
      "1;bg;*;default",
      "1;bg;red;brightness;58",
      "1;bg;green;brightness;112",
      "1;bg;blue;brightness;70",
    ]);
    expect(colors).toEqual([null, "#3a7046"]);
  });

  it("holds off until the color is complete", () => {
    expect(feed(["1;bg;red;brightness;58"]).colors).toEqual([]);
    expect(feed(["1;bg;red;brightness;58", "1;bg;green;brightness;112"]).colors).toEqual([]);
  });

  it("re-emits when a single channel changes, keeping the others", () => {
    const { colors } = feed([
      "1;bg;red;brightness;255", "1;bg;green;brightness;0", "1;bg;blue;brightness;0",
      "1;bg;red;brightness;0", "1;bg;green;brightness;255",
    ]);
    expect(colors).toEqual(["#ff0000", "#000000", "#00ff00"]);
  });

  it("clears on reset and starts the next color from scratch", () => {
    const { channels, colors } = feed([
      "1;bg;red;brightness;58", "1;bg;green;brightness;112", "1;bg;blue;brightness;70",
      "1;bg;*;default",
      "1;bg;red;brightness;58",
    ]);
    expect(colors).toEqual(["#3a7046", null]);
    expect(channels).toEqual({ red: 58 });
  });

  it("ignores payloads it does not handle, leaving the channels alone", () => {
    const kept = { red: 58 };
    expect(applyTabColor(kept, "1;fg;red;brightness;58")).toEqual({ channels: kept });
    expect(applyTabColor(kept, "2;bg;red;brightness;58")).toEqual({ channels: kept });
    expect(applyTabColor(kept, "nonsense")).toEqual({ channels: kept });
  });

  it("clamps a channel above the byte range", () => {
    const { colors } = feed(["1;bg;red;brightness;999", "1;bg;green;brightness;0", "1;bg;blue;brightness;0"]);
    expect(colors).toEqual(["#ff0000"]);
  });
});
