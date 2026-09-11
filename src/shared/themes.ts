export const colorKeys = ["bg", "panel", "card", "card2", "overlay", "edge", "edge2", "edge3", "ink", "body", "soft", "mut", "dim", "accent", "green", "blue", "orange", "red"] as const;
export type ThemeColors = Record<(typeof colorKeys)[number], string>;
export interface DeckTheme {
  id: string;
  name: string;
  appearance: "dark" | "light";
  colors: ThemeColors;
  terminal: Record<string, string>;
  source?: string;
}
const darkColors: ThemeColors = {
  bg: "#080808", panel: "#111111", card: "#171717", card2: "#232323", overlay: "#191919",
  edge: "#232323", edge2: "#303030", edge3: "#424242", ink: "#e7e7e7", body: "#aaa9a7", soft: "#d0cfcc",
  mut: "#858583", dim: "#71716e", accent: "#a78bfa", green: "#4ade80", blue: "#38bdf8", orange: "#fb923c", red: "#f87171",
};
const terminalBase = {
  black: "#15151a", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#c0caf5",
  brightBlack: "#636777", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68", brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#e6e6e9",
};
function theme(id: string, name: string, colors: Partial<ThemeColors>, appearance: DeckTheme["appearance"] = "dark"): DeckTheme {
  const palette = { ...darkColors, ...colors };
  return { id, name, appearance, colors: palette, terminal: { ...terminalBase, background: palette.bg, foreground: palette.ink, cursor: palette.accent, selectionBackground: appearance === "light" ? "#c6d7ef" : "#33415e" }, source: "Built in" };
}
export const builtInThemes: DeckTheme[] = [
  theme("dark", "Carbon", {}),
  theme("midnight", "Midnight", { bg: "#0d111c", panel: "#111726", card: "#171e30", card2: "#202a40", overlay: "#171e30", edge: "#20293c", edge2: "#2d3850", edge3: "#44516c", ink: "#dde6f4", body: "#aab8d0", soft: "#c5d2e7", mut: "#8c9db8", dim: "#7889a5", accent: "#82aaff" }),
  theme("forest", "Forest", { bg: "#101713", panel: "#151e18", card: "#1d2820", card2: "#29372c", overlay: "#1d2820", edge: "#2a362c", edge2: "#37463a", edge3: "#506453", ink: "#e0e9dd", body: "#adbda9", soft: "#c9d7c3", mut: "#8fa58a", dim: "#7d9478", accent: "#a9c998" }),
  theme("rose", "Rose Pine", { bg: "#191724", panel: "#1f1d2e", card: "#26233a", card2: "#353047", overlay: "#26233a", edge: "#302c43", edge2: "#403a55", edge3: "#59516f", ink: "#e0def4", body: "#b1abc9", soft: "#d1cde7", mut: "#a29ab9", dim: "#9088a5", accent: "#c4a7e7", green: "#9ccfd8", red: "#eb6f92", orange: "#f6c177", blue: "#9ccfd8" }),
  theme("light", "Paper", { bg: "#faf9f6", panel: "#f1f0ec", card: "#ffffff", card2: "#e7e6e1", overlay: "#ffffff", edge: "#deded7", edge2: "#c9ccc6", edge3: "#a7aca5", ink: "#202722", body: "#48544b", soft: "#303c33", mut: "#616f64", dim: "#738077", accent: "#6e4cb3", green: "#287547", blue: "#27679c", orange: "#a45b22", red: "#b3404a" }, "light"),
];
builtInThemes[4].terminal = { ...builtInThemes[4].terminal, ...{ black: "#202722", red: "#b3404a", green: "#287547", yellow: "#956316", blue: "#27679c", magenta: "#7954a8", cyan: "#23747c", white: "#b7bdb6", brightBlack: "#738077", brightWhite: "#faf9f6", brightRed: "#b3404a", brightGreen: "#287547", brightYellow: "#956316", brightBlue: "#27679c", brightMagenta: "#7954a8", brightCyan: "#23747c" } };

const HEX = /^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i;
export function parseTheme(value: unknown): DeckTheme {
  if (!value || typeof value !== "object") throw new Error("Theme must be a JSON object.");
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id)) throw new Error("Theme id must contain lowercase letters, numbers and hyphens.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) throw new Error("Theme needs a name (up to 80 characters).");
  if (input.appearance !== undefined && input.appearance !== "dark" && input.appearance !== "light") throw new Error("Theme appearance must be dark or light.");
  if (input.extends !== undefined && !builtInThemes.some((theme) => theme.id === input.extends)) throw new Error("Unknown base theme.");
  if (input.terminal != null && (typeof input.terminal !== "object" || Array.isArray(input.terminal))) throw new Error("Terminal colors must be an object.");
  const base = builtInThemes.find((theme) => theme.id === input.extends) ?? builtInThemes[input.appearance === "light" ? 4 : 0];
  const colors = { ...base.colors };
  if (input.colors != null && (typeof input.colors !== "object" || Array.isArray(input.colors))) throw new Error("Theme colors must be an object.");
  for (const [key, color] of Object.entries(input.colors ?? {})) {
    if (!colorKeys.includes(key as keyof ThemeColors)) throw new Error(`Unknown theme color: ${key}`);
    if (typeof color !== "string" || !HEX.test(color)) throw new Error(`Invalid hex color for ${key}.`);
    colors[key as keyof ThemeColors] = color;
  }
  const terminal: Record<string, string> = { ...base.terminal, background: colors.bg, foreground: colors.ink, cursor: colors.accent };
  for (const [key, color] of Object.entries(input.terminal ?? {})) {
    if (!(key in terminal) || typeof color !== "string" || !HEX.test(color)) throw new Error(`Invalid terminal color: ${key}`);
    terminal[key] = color;
  }
  return { id: input.id, name: input.name.trim(), appearance: input.appearance === "light" ? "light" : base.appearance, colors, terminal };
}
