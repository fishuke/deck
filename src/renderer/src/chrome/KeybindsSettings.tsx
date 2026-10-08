import { useState } from "react";
import { chordOf, defaultKeybinds, formatChord, keybindInfos, resolveKeybinds, type KeybindCommand, type KeybindInfo } from "../../../shared/keybinds.js";
import { RECORDING_ATTRIBUTE } from "../lib/useKeybinds.js";
import { useSettings } from "../lib/useSettings.js";
import { FixedGroup, fixedGroups, kbd } from "./shortcutReference.js";

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
            <p className="mt-1 text-xs leading-5 text-mut">Click a shortcut and press the new keys. Shortcuts need ⌘, ⌃ or ⌥ so they never clash with typing.</p>
            <table className="mt-4 w-full text-xs"><tbody>{keybindInfos.filter((info) => info.group === group).map(row)}</tbody></table>
          </section>
        ))}
        <FixedGroup title="System" description="Configurable under General & integrations." bindings={[[[summon], "Summon Deck from anywhere"]]} />
        {fixedGroups.map((group) => <FixedGroup key={group.title} {...group} />)}
      </div>
    </div>
  );
}
