"use client";

import { useSyncExternalStore } from "react";
import { timeAgo } from "@/lib/status";

// One shared clock for every <TimeAgo>, ticking while any is mounted.
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach((l) => l());
  }, 30_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    timer = undefined;
    now = 0;
  };
}

const getSnapshot = () => (now ||= Date.now());
const getServerSnapshot = () => 0;

// The server render and the hydration pass both use `renderedAt` (the server's
// request time, sent in the RSC payload), so their text always matches. Right
// after hydration React re-renders with the browser's clock.
export function TimeAgo({ iso, renderedAt, timeZone, className }: { iso: string; renderedAt: number; timeZone: string; className?: string }) {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <time dateTime={iso} className={className}>
      {timeAgo(iso, live || renderedAt, timeZone)}
    </time>
  );
}
