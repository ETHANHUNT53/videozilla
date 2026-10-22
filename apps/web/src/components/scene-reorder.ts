"use client";

import { useRef, useState } from "react";

/**
 * Drag-and-drop of scene cards (F3.6, your answer), with no extra library: a ⋮⋮ handle on each card that
 * - a mouse or a finger drags (pointer events with capture; the page scrolls near the top and bottom edges);
 * - the keyboard moves: Space or Enter picks the scene up, ↑ / ↓ move it, Space or Enter drops it, Escape cancels;
 * each step is described in `announce` for a live region. The new order shows while dragging; `onDrop` gets the scene
 * and the scene it now follows (null: first), and the order stays until the ids change (saved) or `reset()` (cancelled).
 */
export function useReorder(opts: { ids: string[]; label: (id: string) => string; onDrop: (id: string, afterId: string | null) => void; disabled?: boolean }) {
  const { ids, label, onDrop, disabled } = opts;
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<{ id: string; by: "pointer" | "keyboard" } | null>(null);
  const [announce, setAnnounce] = useState("");
  const items = useRef(new Map<string, HTMLElement>());
  const handles = useRef(new Map<string, HTMLElement>());
  // Moving a card moves its focused handle in the page, which can blur it: refocus it, and don't treat that blur as
  // leaving (which cancels a keyboard move).
  const refocusing = useRef(false);
  // A new order from the server (saved, or another version shown): drop the local one.
  const [seen, setSeen] = useState(ids.join(","));
  if (seen !== ids.join(",")) {
    setSeen(ids.join(","));
    setOrder(null);
    setDragging(null);
  }
  const shown = order ?? ids;

  const start = (id: string, by: "pointer" | "keyboard") => {
    setDragging({ id, by });
    setOrder(shown);
    if (by === "keyboard") setAnnounce(`Picked up ${label(id)}, position ${shown.indexOf(id) + 1} of ${shown.length}. Use the up and down arrow keys to move it, Space to drop it, Escape to cancel.`);
  };
  const cancel = () => {
    const id = dragging?.id;
    setDragging(null);
    setOrder(null);
    if (id) setAnnounce(`Cancelled. ${label(id)} stays where it was.`);
  };
  const drop = () => {
    if (!dragging) return;
    const id = dragging.id;
    const final = order ?? ids;
    setDragging(null);
    if (final.join(",") === ids.join(",")) {
      setOrder(null);
      setAnnounce(`${label(id)} dropped where it was.`);
      return;
    }
    const at = final.indexOf(id);
    setAnnounce(`${label(id)} dropped at position ${at + 1} of ${final.length}.`);
    onDrop(id, at > 0 ? final[at - 1] : null);
  };
  const moveTo = (id: string, index: number) => {
    const current = (order ?? ids).filter((x) => x !== id);
    const clamped = Math.max(0, Math.min(current.length, index));
    const next = [...current.slice(0, clamped), id, ...current.slice(clamped)];
    setOrder(next);
    return next;
  };

  /** Props for a card's handle button. */
  const handle = (id: string) => ({
    "aria-label": `Reorder ${label(id)}`,
    "aria-describedby": "reorder-help",
    "aria-pressed": dragging?.id === id ? true : undefined,
    disabled,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (disabled) return;
      const picked = dragging?.id === id && dragging.by === "keyboard";
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (picked) drop();
        else if (!dragging) start(id, "keyboard");
      } else if (picked && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const from = (order ?? ids).indexOf(id);
        const next = moveTo(id, from + (e.key === "ArrowUp" ? -1 : 1));
        setAnnounce(`${label(id)}, position ${next.indexOf(id) + 1} of ${next.length}.`);
        refocusing.current = true;
        setTimeout(() => {
          handles.current.get(id)?.focus();
          items.current.get(id)?.scrollIntoView({ block: "nearest" });
          refocusing.current = false;
        }, 0);
      } else if (picked && e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
    onBlur: () => {
      if (!refocusing.current && dragging?.id === id && dragging.by === "keyboard") cancel();
    },
    ref: (el: HTMLElement | null) => {
      if (el) handles.current.set(id, el);
      else handles.current.delete(id);
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId); // moves keep coming here when the finger leaves the handle
      } catch {
        // no capture (the pointer is already gone): the drag still works while over the handle
      }
      start(id, "pointer");
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (dragging?.id !== id || dragging.by !== "pointer") return;
      const y = e.clientY;
      // Where it lands: after every other card whose middle is above the pointer.
      const others = (order ?? ids).filter((x) => x !== id);
      let index = 0;
      for (const other of others) {
        const box = items.current.get(other)?.getBoundingClientRect();
        if (box && box.top + box.height / 2 < y) index++;
      }
      if ((order ?? ids).indexOf(id) !== index) moveTo(id, index);
      if (y < 80) window.scrollBy(0, -14);
      else if (y > window.innerHeight - 80) window.scrollBy(0, 14);
    },
    onPointerUp: () => {
      if (dragging?.id === id && dragging.by === "pointer") drop();
    },
    onPointerCancel: () => {
      if (dragging?.id === id) cancel();
    },
  });

  /** Registers a card's element (for the pointer's position). */
  const itemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) items.current.set(id, el);
    else items.current.delete(id);
  };

  return { order: shown, dragging: dragging?.id ?? null, announce, handle, itemRef, reset: () => setOrder(null) };
}
