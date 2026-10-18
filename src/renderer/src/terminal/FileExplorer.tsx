import { useEffect, useState } from "react";
import { baseName } from "../../../shared/platform.js";
import type { FileEntry, LocalFile } from "../../../main/files.js";
import { Icon } from "../board/icons.js";
import { Markdown } from "../board/Markdown.js";

export function FileExplorer({ cwd: activeCwd, onClose }: { cwd?: string; onClose: () => void }) {
  const [cwd, setCwd] = useState(activeCwd);
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string>();
  const [original, setOriginal] = useState<LocalFile>();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(original && original.text !== text);
  useEffect(() => { if (!dirty && !saving) setCwd(activeCwd); }, [activeCwd, dirty, saving]);
  useEffect(() => { setDirectory(""); setSelected(undefined); setOriginal(undefined); setText(""); }, [cwd]);
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    setError("");
    void window.deck.files.list(cwd, directory).then((entries) => { if (!cancelled) setEntries(entries); })
      .catch((error) => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [cwd, directory, revision]);
  const openFile = async (file: string) => {
    if (!cwd) return;
    setError("");
    try { const next = await window.deck.files.read(cwd, file); setSelected(file); setOriginal(next); setText(next.text); setEditing(false); }
    catch (error) { setError(String(error)); }
  };
  const save = async () => {
    if (!cwd || !selected || !original) return;
    setSaving(true); setError("");
    try { setOriginal(await window.deck.files.save(cwd, selected, { text, modified: original.modified })); }
    catch (error) { setError(String(error)); }
    finally { setSaving(false); }
  };
  return <section className="flex w-[340px] shrink-0 flex-col border-l border-edge bg-panel font-sans">
    <div className="flex h-10 items-center gap-2 border-b border-edge px-3 text-xs"><Icon name="folder" /><span className="text-soft">File explorer</span><button title="Refresh" className="ml-auto text-mut hover:text-ink" onClick={() => setRevision((n) => n + 1)}>↻</button><button title="Close file explorer" onClick={onClose}><Icon name="x" /></button></div>
    {error && <div className="p-3 text-xs text-red">{error}</div>}
    {dirty && <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-[11px] text-orange"><span title={cwd}>Unsaved changes{cwd !== activeCwd ? " · " + (cwd && baseName(cwd)) : ""}</span><button disabled={saving} onClick={() => void save()} className="ml-auto text-soft">{saving ? "Saving…" : "Save"}</button><button onClick={() => { setText(original!.text); setEditing(false); }} className="text-mut">Discard</button></div>}
    {!cwd ? <div className="p-3 text-xs text-dim">Open a terminal to browse its project.</div> : selected && original ? <>
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-[11px]"><button disabled={dirty || saving} title="Back to files" onClick={() => setSelected(undefined)} className="text-mut disabled:opacity-30">←</button><span className="min-w-0 flex-1 truncate text-soft" title={selected}>{selected}</span><button onClick={() => setEditing(!editing)} className="text-mut">{editing ? "Preview" : "Edit"}</button></div>
      {editing ? <textarea aria-label={`Edit ${selected}`} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); void save(); } }} className="min-h-0 flex-1 resize-none bg-bg p-3 font-mono text-[11px] leading-5 text-soft outline-none" /> : <div className="min-h-0 flex-1 overflow-auto p-3">{/\.md$/i.test(selected) ? <Markdown>{text}</Markdown> : <pre className="font-mono text-[11px] leading-5 text-soft">{text}</pre>}</div>}
    </> : <>
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-[11px] text-mut"><button disabled={!directory} onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))} className="disabled:opacity-30">↑</button><span className="truncate">{directory || baseName(cwd)}</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{entries.map((entry) => <button key={entry.path} onClick={() => entry.directory ? setDirectory(entry.path) : void openFile(entry.path)} className="menu-item"><Icon name={entry.directory ? "folder" : "file"} size={13} className="text-mut" /><span className="truncate">{entry.name}</span>{entry.directory && <Icon name="chevronRight" className="ml-auto text-dim" size={11} />}</button>)}{!entries.length && <div className="p-3 text-xs text-dim">Empty directory</div>}</div>
    </>}
  </section>;
}
