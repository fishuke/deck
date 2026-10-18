import { useState } from "react";
import { isMac } from "../../../shared/platform.js";
import { chordOf, defaultKeybinds, formatChord, keybindInfos, primaryHint, resolveKeybinds, type KeybindCommand, type KeybindInfo } from "../../../shared/keybinds.js";
import { RECORDING_ATTRIBUTE } from "../lib/useKeybinds.js";
import { useSettings } from "../lib/useSettings.js";

type Fixed = [keys: string[], action: string];

const fixedGroups: { title: string; description: string; bindings: Fixed[] }[] = [
  {
    title: "Terminal tabs",
    description: "Fixed.",
    bindings: [
      [[`${primaryHint}1`, "…", `${primaryHint}9`], "Switch to tab by position"],
      [[`${primaryHint}⏎`], "Run the multiline input"],
      [["esc"], "Leave Zen or Presentation view"],
    ],
  },
  {
    title: "Search palette",
    description: "While the search palette is open. Fixed.",
    bindings: [
      [["↑", "↓"], "Move the selection"],
      [["⏎"], "Open the selected item"],
      [[`${primaryHint}⏎`], "Open the selected item in a new pane"],
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

const kbd = "rounded border border-edge2 bg-card px-1.5 py-0.5 font-mono text-[11px] text-soft";

export function KeybindsSettings() {
  const settings = useSettings();
  const [recording, setRecording] = useState<KeybindCommand>();
  const [conflict, setConflict] = useState<{ id: KeybindCommand; with: string }>();
  if (!settings) return null;
  const keybinds = resolveKeybinds(settings.keybinds);
  const summon = settings.summonHotkeyEnabled ? settings.summonHotkey : "disabled";
  const customized = Object.keys(settings.keybinds).length > 0;

  const update = (overrides: typeof settings.keybinds) => void window.deck.updateSettings({ keybinds: overrides });
  const record = (id: KeybindCommand, event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { setRecording(undefined); return; }
    const chord = chordOf(event.nativeEvent);
    // A bare key would fire while typing in the terminal.
    if (!chord || !(event.metaKey || event.ctrlKey || event.altKey)) return;
    const taken = keybindInfos.find((info) => info.id !== id && keybinds[info.id] === chord);
    if (taken) { setConflict({ id, with: taken.label }); return; }
    setConflict(undefined);
    setRecording(undefined);
    const { [id]: _, ...rest } = settings.keybinds;
    update(chord === defaultKeybinds[id] ? rest : { ...rest, [id]: chord });
  };
  const reset = (id: KeybindCommand) => { const { [id]: _, ...rest } = settings.keybinds; update(rest); };

  const row = (info: KeybindInfo) => {
    const chord = keybinds[info.id];
    const isRecording = recording === info.id;
    return (
      <tr key={info.id} className="border-t border-edge2 first:border-t-0">
        <td className="py-2 pr-4 text-dim">
          {info.label}
          {conflict?.id === info.id && <span className="ml-2 text-orange">already used by “{conflict.with}”</span>}
        </td>
        <td className="py-2 text-right whitespace-nowrap">
          {chord !== info.default && !isRecording && <button onClick={() => reset(info.id)} className="mr-2 text-[11px] text-mut hover:text-soft">reset</button>}
          <button aria-label={`Change shortcut for ${info.label}`} title="Click, then press the new shortcut. Esc cancels."
            {...(isRecording ? { [RECORDING_ATTRIBUTE]: "" } : {})}
            onClick={() => { setConflict(undefined); setRecording(info.id); }}
            onBlur={() => { if (isRecording) { setRecording(undefined); setConflict(undefined); } }}
            onKeyDown={(event) => { if (isRecording) record(info.id, event); }}
            className={`${kbd} hover:border-edge3 ${isRecording ? "border-accent text-accent" : ""} ${chord !== info.default ? "text-accent" : ""}`}>
            {isRecording ? "press keys…" : formatChord(chord)}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 font-sans">
      <div className="grid max-w-[1120px] grid-cols-1 gap-4 lg:grid-cols-2">
        {(["Workbench", "Terminal"] as const).map((group) => (
          <section key={group} className="rounded-xl border border-edge2 bg-panel p-5">
            <div className="flex items-baseline">
              <h3 className="text-sm font-semibold text-ink">{group}</h3>
              {group === "Workbench" && customized && <button onClick={() => update({})} className="ml-auto text-[11px] text-mut hover:text-soft">reset all</button>}
            </div>
            <p className="mt-1 text-xs leading-5 text-mut">Click a shortcut and press the new keys. Shortcuts need {isMac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"} so they never clash with typing.</p>
            <table className="mt-4 w-full text-xs"><tbody>{keybindInfos.filter((info) => info.group === group).map(row)}</tbody></table>
          </section>
        ))}
        <FixedGroup title="System" description="Configurable under General & integrations." bindings={[[[summon], "Summon Deck from anywhere"]]} />
        {fixedGroups.map((group) => <FixedGroup key={group.title} {...group} />)}
      </div>
    </div>
  );
}

function FixedGroup({ title, description, bindings }: { title: string; description: string; bindings: Fixed[] }) {
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
