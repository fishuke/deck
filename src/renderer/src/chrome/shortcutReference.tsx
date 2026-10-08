/** Shortcuts deck does not route through keybinds.ts, and the table style both
 *  the settings page and the ? overlay list them with. */

export type Fixed = [keys: string[], action: string];

export const kbd = "rounded border border-edge2 bg-card px-1.5 py-0.5 font-mono text-[11px] text-soft";

export const fixedGroups: { title: string; description: string; bindings: Fixed[] }[] = [
  {
    title: "Terminal tabs",
    description: "Fixed.",
    bindings: [
      [["⌘1", "…", "⌘9"], "Switch to tab by position"],
      [["⌘⏎"], "Run the multiline input"],
      [["esc"], "Leave Zen or Presentation view"],
    ],
  },
  {
    title: "Search palette",
    description: "While the search palette is open. Fixed.",
    bindings: [
      [["↑", "↓"], "Move the selection"],
      [["⏎"], "Open the selected item"],
      [["⌘⏎"], "Open the selected item in a new pane"],
      [["esc"], "Close the palette"],
    ],
  },
  {
    title: "Reviews",
    description: "Single keys on the reviews page and the pull request screen. Fixed.",
    bindings: [
      [["n", "]"], "Next review"],
      [["p", "["], "Previous review"],
      [["1", "2"], "Pull request overview / diff"],
      [["j", "k"], "Next / previous file in the diff"],
      [["v"], "Mark the current file as viewed"],
      [["a"], "Toggle the review agent"],
      [["esc"], "Close menus, composers or the pull request"],
    ],
  },
];

export function FixedGroup({ title, description, bindings }: { title: string; description: string; bindings: Fixed[] }) {
  return (
    <section className="rounded-xl border border-edge2 bg-panel p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-mut">{description}</p>
      <table className="mt-4 w-full text-xs">
        <tbody>
          {bindings.map(([keys, action]) => (
            <tr key={action} className="border-t border-edge2 first:border-t-0">
              <td className="py-2 pr-4 text-dim">{action}</td>
              <td className="py-2 text-right whitespace-nowrap">
                {keys.map((key, i) => key === "…" ? <span key={i} className="mx-1 text-mut">…</span> : <kbd key={key} className={`ml-1 ${kbd}`}>{key}</kbd>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
