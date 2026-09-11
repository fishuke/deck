import { useEffect, useState } from "react";
import { defaultSettings, type DeckSettings } from "../../../shared/settings.js";
import { MAX_FONT_SIZE, MAX_LETTER_SPACING, MAX_LINE_HEIGHT, MIN_FONT_SIZE, MIN_LETTER_SPACING, MIN_LINE_HEIGHT, type CursorStyle } from "../../../shared/terminal.js";
import { parseTheme } from "../../../shared/themes.js";
import { Icon } from "../board/icons.js";
import { control, Field } from "../chrome/settingsUi.js";
import { useSettings } from "../lib/useSettings.js";
import { useExtensions } from "./ExtensionProvider.js";


function TerminalFont() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [customFont, setCustomFont] = useState(false);
  const appearance = settings?.terminalAppearance ?? defaultSettings.terminalAppearance;
  const fontPreset = customFont || (appearance.fontFamily !== "" && appearance.fontFamily !== "JetBrains Mono") ? "custom" : appearance.fontFamily;
  const update = (patch: Partial<DeckSettings["terminalAppearance"]>) =>
    void window.deck.updateSettings({ terminalAppearance: { ...appearance, ...patch } });
  const summary = `${appearance.fontFamily || "Platform monospace"} · ${appearance.fontSize}px`;
  return <>
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-edge2 bg-panel p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-card2 text-accent"><Icon name="terminal" size={17} /></span>
      <div className="flex-1"><div className="text-xs font-medium text-soft">Terminal font</div><p className="mt-1 text-[11px] text-mut">{summary}</p></div>
      <button aria-expanded={open} onClick={() => setOpen((was) => !was)} className="rounded-md border border-edge3 px-3 py-1.5 text-xs text-soft hover:bg-card2">{open ? "Done" : "Change"}</button>
    </div>
    {open && <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-edge2 bg-panel p-4 lg:grid-cols-4">
      <div className="col-span-2 lg:col-span-2"><Field label="Family">
        <select aria-label="Terminal font family" className={control} value={fontPreset}
          onChange={(event) => {
            const fontFamily = event.target.value;
            setCustomFont(fontFamily === "custom");
            if (fontFamily !== "custom") update({ fontFamily });
          }}>
          <option value="">Platform monospace</option>
          <option value="JetBrains Mono">JetBrains Mono</option>
          <option value="custom">Custom font…</option>
        </select>
      </Field></div>
      {fontPreset === "custom" && <div className="col-span-2"><Field label="Custom font family">
        <input placeholder="FiraCode Nerd Font" className={control} defaultValue={appearance.fontFamily}
          onBlur={(event) => { const fontFamily = event.target.value.trim(); if (fontFamily !== appearance.fontFamily) update({ fontFamily }); }} />
      </Field></div>}
      <Field label="Size">
        <input type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} className={control} defaultValue={appearance.fontSize}
          onBlur={(event) => { const fontSize = Number(event.target.value); if (fontSize && fontSize !== appearance.fontSize) update({ fontSize }); }} />
      </Field>
      <Field label="Line height">
        <input type="number" step={0.05} min={MIN_LINE_HEIGHT} max={MAX_LINE_HEIGHT} className={control} defaultValue={appearance.lineHeight}
          onBlur={(event) => { const lineHeight = Number(event.target.value); if (lineHeight && lineHeight !== appearance.lineHeight) update({ lineHeight }); }} />
      </Field>
      <Field label="Letter spacing">
        <input type="number" min={MIN_LETTER_SPACING} max={MAX_LETTER_SPACING} className={control} defaultValue={appearance.letterSpacing}
          onBlur={(event) => { const letterSpacing = Number(event.target.value); if (Number.isFinite(letterSpacing) && letterSpacing !== appearance.letterSpacing) update({ letterSpacing }); }} />
      </Field>
      <Field label="Weight">
        <input placeholder="normal or 100-900" className={control} defaultValue={appearance.fontWeight}
          onBlur={(event) => { const fontWeight = event.target.value.trim(); if (fontWeight !== appearance.fontWeight) update({ fontWeight }); }} />
      </Field>
      <Field label="Bold weight">
        <input placeholder="bold or 100-900" className={control} defaultValue={appearance.fontWeightBold}
          onBlur={(event) => { const fontWeightBold = event.target.value.trim(); if (fontWeightBold !== appearance.fontWeightBold) update({ fontWeightBold }); }} />
      </Field>
      <Field label="Cursor">
        <select aria-label="Cursor style" className={control} value={appearance.cursorStyle}
          onChange={(event) => update({ cursorStyle: event.target.value as CursorStyle })}>
          <option value="block">Block</option><option value="underline">Underline</option><option value="bar">Bar</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 self-end text-[11px] text-mut">
        <input type="checkbox" checked={appearance.cursorBlink} onChange={(event) => update({ cursorBlink: event.target.checked })} />Blink
      </label>
    </div>}
  </>;
}

export function AppearanceSettings() {
  const { themes, theme, selectedThemeId: selectedId, selectTheme, previewTheme, reload, catalog } = useExtensions();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => previewTheme(undefined), [previewTheme]);
  const choose = async (id: string) => {
    try { await selectTheme(id); setError(""); }
    catch (error) { setError(String(error)); }
  };
  const customize = () => {
    setDraft(JSON.stringify({ id: "my-theme", name: "My theme", appearance: theme.appearance, colors: theme.colors, terminal: theme.terminal }, null, 2));
    setEditing(true); setError("");
  };
  const preview = () => {
    try { previewTheme(parseTheme(JSON.parse(draft))); setError(""); }
    catch (error) { setError(String(error)); }
  };
  const save = async () => {
    setBusy(true);
    try { const saved = await window.deck.extensions.saveTheme(JSON.parse(draft)); await reload(); await choose(saved.id); setEditing(false); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 font-sans">
    <div className="max-w-[860px]">
      <div className="flex items-start gap-4"><div className="flex-1"><h2 className="text-base font-semibold text-ink">Make Deck yours</h2><p className="mt-1 text-xs leading-5 text-mut">One palette for your workspace and terminal. Hover a theme to preview it.</p></div><button onClick={async () => { try { const imported = await window.deck.extensions.importTheme(); if (imported) { await reload(); await choose(imported.id); } } catch (error) { setError(String(error)); } }} className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-body hover:border-edge3">Import theme</button></div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {themes.map((candidate) => <button key={candidate.id} aria-label={`Use ${candidate.name} theme`} aria-pressed={selectedId === candidate.id}
          onMouseEnter={() => { if (!editing) previewTheme(candidate); }} onMouseLeave={() => { if (!editing) previewTheme(undefined); }}
          onClick={() => void choose(candidate.id)} className={`overflow-hidden rounded-xl border text-left transition-colors ${selectedId === candidate.id ? "border-accent" : "border-edge2 hover:border-edge3"}`}>
          <div className="flex h-28 gap-3 p-3" style={{ background: candidate.colors.bg }}>
            <div className="w-10 rounded-md p-1.5" style={{ background: candidate.colors.panel }}><div className="h-1 w-4 rounded" style={{ background: candidate.colors.dim }} /><div className="mt-3 h-5 rounded" style={{ background: candidate.colors.card2 }} /><div className="mt-2 h-1 rounded" style={{ background: candidate.colors.edge3 }} /></div>
            <div className="flex-1 py-1 font-mono text-[10px]"><div style={{ color: candidate.colors.mut }}>~/projects/deck</div><div className="mt-2" style={{ color: candidate.colors.ink }}><span style={{ color: candidate.colors.accent }}>❯</span> make something great</div><div className="mt-2 flex gap-1.5">{["accent", "green", "blue", "orange", "red"].map((color) => <span key={color} className="h-2 w-2 rounded-full" style={{ background: candidate.colors[color as keyof typeof candidate.colors] }} />)}</div></div>
          </div>
          <div className="flex items-center gap-2 border-t border-edge bg-panel px-3 py-2.5"><span className="text-xs font-medium text-soft">{candidate.name}</span><span className="ml-auto truncate text-[10px] text-dim">{candidate.source}</span>{selectedId === candidate.id && <Icon name="check" className="text-accent" />}</div>
        </button>)}
      </div>
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-edge2 bg-panel p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-card2 text-accent"><Icon name="pencil" size={17} /></span><div className="flex-1"><div className="text-xs font-medium text-soft">Your own palette</div><p className="mt-1 text-[11px] text-mut">Start with this theme, edit its colors, and share the JSON file.</p></div><button onClick={customize} className="rounded-md border border-edge3 px-3 py-1.5 text-xs text-soft hover:bg-card2">Customize</button></div>
      {error && <div role="alert" className="mt-4 rounded-lg border border-red/30 bg-red/5 p-3 text-xs text-red">{error}</div>}
      {editing && <div className="mt-4 rounded-xl border border-edge2 bg-panel p-4"><div className="mb-3 flex items-center gap-2"><span className="text-xs font-medium text-soft">Custom theme</span><span className="ml-auto text-[10px] text-mut">Hex colors · live preview</span></div><textarea aria-label="Custom theme JSON" spellCheck={false} rows={14} value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full resize-y rounded-md border border-edge2 bg-bg p-3 font-mono text-[11px] leading-5 text-soft outline-none focus:border-edge3" /><div className="mt-3 flex justify-end gap-2 text-xs"><button onClick={() => { previewTheme(undefined); setEditing(false); }} className="px-3 py-1.5 text-mut">Cancel</button><button onClick={preview} className="rounded-md border border-edge2 px-3 py-1.5 text-body">Preview</button><button disabled={busy} onClick={() => void save()} className="rounded-md bg-accent px-3 py-1.5 text-bg disabled:opacity-50">{busy ? "Saving…" : "Save theme"}</button></div></div>}
      <TerminalFont />
      <button onClick={() => void window.deck.extensions.openFolder("themes")} className="mt-5 flex items-center gap-1.5 text-[11px] text-mut hover:text-soft"><Icon name="folder" size={12} />Open themes folder</button>
      {catalog.errors.map((error) => <div key={error} className="mt-2 text-xs text-red">{error}</div>)}
    </div>
  </div>;
}

export function PluginsSettings() {
  const { catalog, commands, errors, reload, runCommand } = useExtensions();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 font-sans"><div className="max-w-[860px]">
    <div className="flex items-start gap-4"><div className="flex-1"><h2 className="text-base font-semibold text-ink">Extend your workspace</h2><p className="mt-1 max-w-xl text-xs leading-5 text-mut">Add themes, commands, agent prompts, and panels. Local plugins reload when you save their files.</p></div><button disabled={busy} onClick={async () => { setBusy(true); try { await window.deck.extensions.installPlugin(); await reload(); setError(""); } catch (error) { setError(String(error)); } finally { setBusy(false); } }} className="rounded-md bg-accent px-3 py-2 text-xs text-bg disabled:opacity-50">Install plugin…</button></div>
    <div className="mt-6 flex items-center gap-3 text-xs text-mut"><span>{catalog.plugins.filter((plugin) => plugin.enabled).length} enabled</span><button onClick={() => void reload()} className="ml-auto hover:text-soft">↻ Reload</button><button onClick={() => void window.deck.extensions.openFolder("plugins")} className="flex items-center gap-1 hover:text-soft"><Icon name="folder" size={12} />Open folder</button></div>
    <div className="mt-3 flex flex-col gap-3">{catalog.plugins.map((plugin) => <div key={plugin.path} className="rounded-xl border border-edge2 bg-panel p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-card2 text-accent"><Icon name="grid" size={18} /></span><div className="min-w-0 flex-1"><div className="text-sm font-medium text-soft">{plugin.name}<span className="ml-2 text-[10px] font-normal text-dim">{plugin.version}</span></div><p className="mt-1 text-xs text-mut">{plugin.description || "Local Deck plugin"}</p></div><label className="flex items-center gap-2 text-[11px] text-mut"><input type="checkbox" checked={plugin.enabled} aria-label={`Enable ${plugin.name}`} onChange={async (event) => { try { await window.deck.extensions.enablePlugin(plugin.path, event.target.checked); await reload(); } catch (error) { setError(String(error)); } }} />Enabled</label></div>{plugin.enabled && <div className="mt-3 flex flex-wrap gap-2">{commands.filter((command) => command.pluginId === plugin.id).map((command) => <button key={command.key} aria-label={command.title} onClick={() => void runCommand(command)} className="rounded-md border border-edge2 px-2 py-1 text-[11px] text-body hover:border-edge3">{command.title}<span className="ml-1.5 text-dim">↗</span></button>)}{plugin.themes.map((theme) => <span key={theme.id} className="rounded-md bg-card2 px-2 py-1 text-[10px] text-mut">Theme: {theme.name}</span>)}</div>}{plugin.error && <p className="mt-3 text-xs text-red">{plugin.error}</p>}</div>)}</div>
    {!catalog.plugins.length && <div className="mt-3 rounded-xl border border-dashed border-edge3 px-6 py-10 text-center"><Icon name="grid" size={24} className="text-dim" /><p className="mt-3 text-sm text-soft">A small core. Room for your ideas.</p><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-mut">Install a folder containing deck-plugin.json, or create your first plugin using the starter in examples/plugins.</p></div>}
    {[error, ...errors].filter(Boolean).map((error, index) => <div key={index} role="alert" className="mt-3 text-xs text-red">{error}</div>)}
  </div></div>;
}
