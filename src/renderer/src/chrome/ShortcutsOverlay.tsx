import { useEffect } from "react";
import { formatAccelerator, formatChord, keybindInfos, resolveKeybinds } from "../../../shared/keybinds.js";
import { useSettings } from "../lib/useSettings.js";
import { FixedGroup, fixedGroups, kbd } from "./shortcutReference.js";

/** Every shortcut at a glance, over whatever page is open. Chords come from
 *  the live keybinds, so a rebind shows here without touching this file. */
export function ShortcutsOverlay({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const settings = useSettings();
  const keybinds = resolveKeybinds(settings?.keybinds);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "?") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const summon = settings?.summonHotkeyEnabled && settings.summonHotkey ? formatAccelerator(settings.summonHotkey) : "disabled";

  return (
    <div onClick={onClose} className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-8 font-sans">
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(event) => event.stopPropagation()}
        className="w-[min(1120px,95vw)] rounded-xl border border-edge3 bg-overlay p-6 shadow-2xl">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <p className="text-xs text-mut">
            <kbd className={kbd}>esc</kbd> closes this.{" "}
            <button onClick={onSettings} className="underline decoration-dotted underline-offset-2 hover:text-soft">Change any of them in Settings</button>.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(["Workbench", "Terminal"] as const).map((group) => (
            <section key={group} className="rounded-xl border border-edge2 bg-panel p-5">
              <h3 className="text-sm font-semibold text-ink">{group}</h3>
              <table className="mt-4 w-full text-xs">
                <tbody>
                  {keybindInfos.filter((info) => info.group === group).map((info) => (
                    <tr key={info.id} className="border-t border-edge2 first:border-t-0">
                      <td className="py-2 pr-4 text-dim">{info.label}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <kbd className={`${keybinds[info.id] !== info.default ? "text-accent" : ""} ${kbd}`}>{formatChord(keybinds[info.id])}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <FixedGroup title="System" description="Configurable under General & integrations." bindings={[[[summon], "Summon deck from anywhere"]]} />
          {fixedGroups.map((group) => <FixedGroup key={group.title} {...group} />)}
        </div>
      </div>
    </div>
  );
}
