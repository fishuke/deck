import { useEffect, useState } from "react";
import type { CanvasFrame } from "../../../main/canvas.js";

/** The drawings an agent posted for one terminal, kept current as new ones land. */
export function useCanvas(termId: string | undefined): CanvasFrame[] {
  const [frames, setFrames] = useState<CanvasFrame[]>([]);
  useEffect(() => {
    setFrames([]);
    if (!termId) return;
    let cancelled = false;
    void window.deck.canvas.get(termId).then((frames) => { if (!cancelled) setFrames(frames); }).catch(() => {});
    const off = window.deck.canvas.onChanged((id, frames) => { if (id === termId) setFrames(frames); });
    return () => { cancelled = true; off(); };
  }, [termId]);
  return frames;
}
