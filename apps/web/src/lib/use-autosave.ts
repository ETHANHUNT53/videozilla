"use client";

import { useEffect, useState } from "react";
import { AutosaveQueue, type AutosaveState } from "./autosave";

/**
 * React wrapper around `AutosaveQueue`: one queue per mounted component, retried when the browser comes back online,
 * flushed when the tab is hidden, and a "Leave site?" warning while a change isn't saved yet.
 */
export function useAutosave<T, R extends { rev: number }>(opts: { rev: number; save: (value: T, rev: number) => Promise<R>; onSaved?: (saved: R) => void }) {
  const [state, setState] = useState<AutosaveState<R>>({ status: "idle" });
  const [queue] = useState(() => new AutosaveQueue<T, R>({ rev: opts.rev, save: opts.save, onSaved: opts.onSaved, onState: setState }));
  // The latest callbacks, so the queue (made once) always calls the current ones.
  useEffect(() => queue.setHandlers({ save: opts.save, onSaved: opts.onSaved }));

  useEffect(() => {
    queue.resume();
    const online = () => queue.retryNow();
    const hidden = () => {
      if (document.visibilityState === "hidden") queue.flush();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!queue.hasUnsaved()) return;
      queue.flush();
      e.preventDefault();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", beforeUnload);
      queue.flush();
      queue.dispose();
    };
  }, [queue]);

  return { state, queue };
}
