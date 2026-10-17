import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Small shared building blocks in the Videozilla style. */

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** "// section" eyebrow, like the videos. */
export function Eyebrow({ children, accent = "text-cyan" }: { children: ReactNode; accent?: string }) {
  return (
    <p className="font-mono text-sm text-muted">
      <span className={accent}>{"// "}</span>
      {children}
    </p>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

export const buttonStyles = {
  // Disabled: a muted outline (not faded cyan), so it never reads as the main action.
  primary: `${buttonBase} bg-cyan text-bg hover:bg-cyan/90 glow-cyan disabled:border disabled:border-line-strong disabled:bg-surface disabled:text-muted`,
  secondary: `${buttonBase} border border-line-strong bg-surface text-fg hover:bg-surface-hover`,
  ghost: `${buttonBase} text-muted hover:text-fg hover:bg-surface`,
  danger: `${buttonBase} border border-red/40 text-red hover:bg-red/10`,
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={cx(buttonStyles[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={cx(buttonStyles[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-dim">{hint}</span> : null}
    </label>
  );
}

export const inputStyles =
  "w-full rounded-xl border border-line-strong bg-raised px-3.5 py-2.5 text-sm text-fg placeholder:text-dim focus:border-cyan focus:outline-none";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputStyles, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputStyles, "appearance-none", props.className)} />;
}

/** Monospace status chip with a glowing dot. */
export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs text-fg">
      <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {children}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 font-mono text-sm text-muted" role="status">
      <span className="size-2 animate-pulse rounded-full bg-cyan" />
      {label}
    </div>
  );
}

export function Logo() {
  return (
    <span className="font-semibold tracking-tight text-fg">
      video<span className="text-cyan">zilla</span>
    </span>
  );
}
