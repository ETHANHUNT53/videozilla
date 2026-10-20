"use client";

import { useId, useRef } from "react";
import { Slashes, cx } from "./ui";

/**
 * A segmented control (Stitch 09's English / हिंदी and ~60s / ~90s): a radio group, so screen readers hear "1 of 2,
 * selected", Tab enters at the chosen option and the arrow keys move and choose (WAI-ARIA radio group pattern).
 */
export function SegmentedControl<V extends string | number>(props: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  disabled?: boolean;
  onChange: (value: V) => void;
}) {
  const { label, options, value, disabled, onChange } = props;
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (by: number) => {
    const next = (index + by + options.length) % options.length;
    refs.current[next]?.focus();
    if (options[next].value !== value) onChange(options[next].value);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="font-mono text-xs text-muted">
        <Slashes />
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className={cx("grid gap-1 rounded-xl border border-line bg-raised p-1", disabled && "opacity-60")}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => !selected && onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(-1);
                }
              }}
              className={cx(
                "rounded-lg px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed",
                selected ? "bg-surface font-medium text-fg shadow-sm ring-1 ring-cyan/40" : "text-muted hover:text-fg",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
