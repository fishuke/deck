import { useEffect, useState } from "react";
import { acceleratorOf, chordOf, formatAccelerator } from "../../../shared/keybinds.js";
import { RECORDING_ATTRIBUTE } from "../lib/useKeybinds.js";
import { useSettings } from "../lib/useSettings.js";
import { control, Toggle } from "./settingsUi.js";
import type { DeckSettings } from "../../../shared/settings.js";

// A fresh profile opens on this instead of the workbench. Deck is built to be
// summoned, so the quake panel gets set up — and pressed once for real —
// before anything else. Everything here also lives in Settings.

const titles = ["Summon deck from anywhere", "Try it", "Where deck lives"];
const kbd = "rounded border border-edge2 bg-card px-1.5 py-0.5 font-mono text-[11px] text-soft";

export function Onboarding() {
  const settings = useSettings();
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [registered, setRegistered] = useState("");
  const [summoned, setSummoned] = useState(false);
  const hotkey = settings?.summonHotkey;
  const hotkeyEnabled = settings?.summonHotkeyEnabled;
  useEffect(() => window.deck.hotkey.onSummoned(() => setSummoned(true)), []);
  // Registration can fail on a combination another app already owns, which
  // only the main process knows, so it is read back after every change.
  useEffect(() => { void window.deck.hotkey.registered().then(setRegistered); }, [hotkey, hotkeyEnabled]);
  if (!settings) return null;

  const update = (patch: Partial<DeckSettings>) => void window.deck.updateSettings(patch);
  const held = settings.summonHotkeyEnabled && registered === settings.summonHotkey;
  const record = (event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { setRecording(false); return; }
    // A bare key would fire while typing anywhere on the machine.
    const chord = event.metaKey || event.ctrlKey || event.altKey ? chordOf(event.nativeEvent) : undefined;
    const accelerator = chord && acceleratorOf(chord);
    if (!accelerator) return;
    setRecording(false);
    setSummoned(false);
    update({ summonHotkey: accelerator, summonHotkeyEnabled: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 font-sans backdrop-blur-sm">
      <div className="flex w-[560px] flex-col gap-5 rounded-2xl border border-edge2 bg-panel p-7 shadow-2xl">
        <div>
          <div className="flex items-center gap-1.5">
            {titles.map((title, index) => (
              <span key={title} className={`h-1 w-8 rounded-full ${index <= step ? "bg-accent" : "bg-edge2"}`} />
            ))}
            <span className="ml-2 text-[11px] text-mut">Step {step + 1} of {titles.length}</span>
          </div>
          <h2 className="mt-4 text-base font-semibold text-ink">{titles[step]}</h2>
        </div>

        <div className="min-h-[228px]">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs leading-5 text-mut">Deck is quickest when it is one keystroke away, dropping over whatever you are doing.</p>
            <div className="flex items-center gap-3">
              <button aria-label="Change the summon hotkey" title="Click, then press the new shortcut. Esc cancels."
                {...(recording ? { [RECORDING_ATTRIBUTE]: "" } : {})}
                onClick={() => setRecording(true)}
                onBlur={() => setRecording(false)}
                onKeyDown={recording ? record : undefined}
                className={`w-44 rounded-md border px-2 py-1.5 font-mono text-sm ${recording ? "border-accent text-accent" : "border-edge2 bg-card text-ink hover:border-edge3"}`}
              >
                {recording ? "Press the keys…" : formatAccelerator(settings.summonHotkey)}
              </button>
              {!settings.summonHotkeyEnabled ? (
                <span className="text-xs text-mut">
                  The hotkey is off.
                  <button className="ml-1.5 text-accent hover:underline" onClick={() => update({ summonHotkeyEnabled: true })}>Turn it on</button>
                </span>
              ) : held ? (
                <span className="text-xs text-green">Held by deck, system wide.</span>
              ) : (
                <span className="text-xs text-orange">Another app already owns this one. Pick a different combination.</span>
              )}
            </div>
            <Toggle checked={settings.summonDockToTop} onChange={(summonDockToTop) => update({ summonDockToTop })}>
              Drop down from the top of the screen, full width (quake style)
            </Toggle>
            <div className={`ml-5 flex flex-col gap-3 border-l border-edge2 pl-4 ${settings.summonDockToTop ? "" : "opacity-50"}`}>
              <Toggle checked={settings.summonHideOnBlur} disabled={!settings.summonDockToTop} onChange={(summonHideOnBlur) => update({ summonHideOnBlur })}>
                Hide again as soon as another app takes focus
              </Toggle>
              <label className="flex items-center gap-3 text-xs text-dim">
                <span>Panel height</span>
                <span className="ml-auto flex items-center gap-1">
                  <input type="number" min={20} max={100} disabled={!settings.summonDockToTop} className={`w-16 text-right ${control}`} defaultValue={Math.round(settings.summonHeightRatio * 100)}
                    onBlur={(e) => { const ratio = Math.min(100, Math.max(20, Number(e.target.value) || 60)) / 100; if (ratio !== settings.summonHeightRatio) update({ summonHeightRatio: ratio }); }} />
                  <span className="text-mut">%</span>
                </span>
              </label>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs leading-5 text-mut">
              Press <span className={kbd}>{formatAccelerator(settings.summonHotkey)}</span> now. Deck drops away; press it again and it comes back over whatever is in front of you. That is how you will open it from here on.
            </p>
            {summoned ? (
              <p className="text-xs text-green">✓ That was the hotkey. Deck is a keystroke away from any app.</p>
            ) : held ? (
              <p className="text-xs text-dim">Waiting for the press…</p>
            ) : (
              <p className="text-xs text-orange">Deck is not holding a hotkey yet — go back a step and pick one that is free.</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs leading-5 text-mut">The hotkey can be all deck needs, or it can bring up a window of its own.</p>
            <label className="block">
              <span className="text-xs text-dim">Hotkey window</span>
              <select aria-label="Hotkey window" className={`mt-1.5 w-full ${control}`} value={settings.windowMode}
                onChange={(e) => update({ windowMode: e.target.value as DeckSettings["windowMode"] })}>
                <option value="shared">Shared with the Dock window</option>
                <option value="panel">Separate window, same tabs</option>
                <option value="panel-own-tabs">Separate window, its own tabs</option>
              </select>
            </label>
            <Toggle checked={settings.hideFromDock} onChange={(hideFromDock) => update({ hideFromDock })}>
              Keep deck out of the Dock and ⌘-Tab — the tray and the hotkey are enough
            </Toggle>
          </div>
        )}

        </div>

        <div className="flex items-center gap-3">
          <button className="text-xs text-mut hover:text-soft" onClick={() => update({ onboarded: true })}>Skip setup</button>
          <span className="ml-auto" />
          {step > 0 && <button className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:border-edge3" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"
            onClick={() => (step === titles.length - 1 ? update({ onboarded: true }) : setStep(step + 1))}>
            {step === titles.length - 1 ? "Start using deck" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
