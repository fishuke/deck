// Stroke icons on a 16×16 grid, sized by font-size so they sit inline with text.
const paths = {
  zen: "M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4",
  presentation: "M2 2h12v9H2zM8 11v3M5 14h6M6 4.5v4l4-2z",
  sidebar: "M2 2h12v12H2zM6 2v12",
  search: "M7 2a5 5 0 110 10A5 5 0 017 2zM11 11l3 3",
  plus: "M8 3v10M3 8h10",
  terminal: "M3 4l4 4-4 4M9 12h4",
  grid: "M2 2h4v4H2zM10 2h4v4h-4zM2 10h4v4H2zM10 10h4v4h-4z",
  layers: "M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3",
  folder: "M2 4h5l1.5 2H14v7H2z",
  file: "M4 2h5l3 3v9H4zM9 2v4h3",
  splitRight: "M2 2h12v12H2zM8 2v12",
  splitDown: "M2 2h12v12H2zM2 8h12",
  sliders: "M3 4h10M3 8h10M3 12h10M6 2v4M10 6v4M6 10v4",
  cog: "M8 3.4a4.6 4.6 0 110 9.2 4.6 4.6 0 010-9.2M8 6a2 2 0 110 4 2 2 0 010-4M12.6 8h1.3M3.4 8h-1.3M8 3.4v-1.3M8 12.6v1.3M11.25 4.75l.92-.92M4.75 4.75l-.92-.92M4.75 11.25l-.92.92M11.25 11.25l.92.92",
  download: "M8 2v8M5 7l3 3 3-3M3 11v3h10v-3",

  branch:
    "M5 5.5v5M5 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM5 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM11 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM11 5.5c0 3.5-6 2.5-6 5",
  checkSquare: "M2.5 2.5h11v11h-11zM5 8l2 2 4-4",
  xSquare: "M2.5 2.5h11v11h-11zM5.5 5.5l5 5M10.5 5.5l-5 5",
  clock: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM8 5v3l2 1.5",
  check: "M3 8.5l3 3 7-7",
  x: "M4 4l8 8M12 4l-8 8",
  circle: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11z",
  dot: "M8 6a2 2 0 110 4 2 2 0 010-4z",
  minus: "M3 8h10",
  link: "M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 013.5 3.5L10.5 8M5.5 8L4.3 9.2a2.5 2.5 0 003.5 3.5L9 11.5",
  external: "M6 3H3v10h10v-3M9 3h4v4M13 3L7.5 8.5",
  chevronDown: "M4 6l4 4 4-4",
  chevronRight: "M6 4l4 4-4 4",
  list: "M3 4.5h10M3 8h10M3 11.5h10",
  commits: "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM2 8h3.5M10.5 8H14",
  expand: "M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3",
  expandDown: "M8 3v8M5 8l3 3 3-3M4 13.5h8",
  expandUp: "M8 13V5M5 8l3-3 3 3M4 2.5h8",
  comment: "M3 3h10v7H8l-3 3v-3H3z",
  pencil: "M3 13l.8-3.2L10.5 3.1a1.3 1.3 0 011.8 0l.6.6a1.3 1.3 0 010 1.8L6.2 12.2z",
  play: "M5 3.5v9l7-4.5z",
  dots: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  sparkle: "M8 2v12M2 8h12M4 4l8 8M12 4l-8 8",
  issue: "M8 2l3 3-3 3-3-3zM5 8l3 3-3 3-3-3zM11 8l3 3-3 3-3-3z",
  broom: "M13.5 2.5L8 8M8 8l2.5 2.5-2 3.5L3 12.5l1.5-3z M5.5 13.5l1.5-3",
} as const;

const filled = new Set<IconName>(["play", "dot"]);

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 13,
  className = "",
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled.has(name) ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={name === "dots" ? 2.5 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  );
}
