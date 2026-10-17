/**
 * Autosave (PRD F10-FR1, API Design §8): saves the latest value 800 ms after the last change, one save at a time,
 * with `If-Match` set to the revision it last saw. Framework-free so it can be unit-tested; `useAutosave` wraps it for
 * React. Safe to import from client components.
 *
 * - **Offline** (network error): retries with backoff, and at once when the browser is back online (`retryNow`).
 * - **Changed in another tab** (`412`): stops and reports the other tab's copy; the user picks `keepMine` (save over it)
 *   or `loadLatest` (take it).
 * - **Not allowed any more** (`409`, `404`): stops for good; the page should reload.
 * - **Rejected** (`400`, `413`): reports it; the next change tries again.
 * - **Server trouble** (`5xx`, `429`): retries with backoff.
 */
import { ApiClientError } from "./api-client";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "offline" | "conflict" | "error";

export interface AutosaveState<R> {
  status: AutosaveStatus;
  /** A message to show, for "error". */
  error?: string;
  /** The other tab's copy, for "conflict". */
  conflict?: R;
  /** True when saving has stopped for good (the resource is gone or locked). */
  stopped?: boolean;
}

export interface AutosaveOptions<T, R extends { rev: number }> {
  /** The revision the page loaded. */
  rev: number;
  save: (value: T, rev: number) => Promise<R>;
  onState: (state: AutosaveState<R>) => void;
  onSaved?: (saved: R) => void;
  delayMs?: number;
  retryDelaysMs?: number[];
}

export const AUTOSAVE_DELAY_MS = 800;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];

export class AutosaveQueue<T, R extends { rev: number }> {
  private rev: number;
  private latest: T | undefined;
  private seq = 0; // bumped on every change
  private savedSeq = 0; // the change the server has
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private state: AutosaveState<R> = { status: "idle" };
  private disposed = false;

  private handlers: Pick<AutosaveOptions<T, R>, "save" | "onSaved">;

  constructor(private readonly opts: AutosaveOptions<T, R>) {
    this.rev = opts.rev;
    this.handlers = { save: opts.save, onSaved: opts.onSaved };
  }

  /** Replace the save / onSaved callbacks (a React component passes fresh ones on every render). */
  setHandlers(handlers: Pick<AutosaveOptions<T, R>, "save" | "onSaved">): void {
    this.handlers = handlers;
  }

  /** The user changed something: save it after the debounce delay. */
  change(value: T): void {
    if (this.disposed) return;
    this.latest = value;
    this.seq++;
    if (this.state.stopped || this.state.status === "conflict") return; // kept, but not saved
    if (!this.inFlight) this.set({ status: "pending" });
    this.schedule(this.opts.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  /** Save now (e.g. when the tab is being hidden), if there is anything to save. */
  flush(): void {
    this.clearTimer();
    if (this.disposed || this.inFlight || this.state.stopped || this.state.status === "conflict") return;
    if (this.seq === this.savedSeq || this.latest === undefined) return;
    void this.send(this.latest);
  }

  /** Back online, or the user asked to retry: try at once instead of waiting for the backoff. */
  retryNow(): void {
    if (this.state.status === "offline" || (this.state.status === "error" && !this.state.stopped)) this.flush();
  }

  /** After a conflict: save the local text over the other tab's copy. */
  keepMine(): void {
    if (this.state.status !== "conflict" || !this.state.conflict) return;
    this.rev = this.state.conflict.rev;
    this.set({ status: "pending" });
    this.flush();
  }

  /** After a conflict: the page shows the other tab's copy (`value`) from now on. */
  loadLatest(value: T, rev: number): void {
    this.clearTimer();
    this.latest = value;
    this.rev = rev;
    this.savedSeq = ++this.seq;
    this.set({ status: "saved" });
  }

  /** Whether leaving now would lose a change. */
  hasUnsaved(): boolean {
    return this.inFlight || this.seq !== this.savedSeq;
  }

  /** Stop all timers and saving (the component unmounted). */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /** Start again after `dispose` (React mounts effects twice in development); saves anything still unsaved. */
  resume(): void {
    if (!this.disposed) return;
    this.disposed = false;
    if (this.hasUnsaved() && !this.inFlight) this.schedule(this.opts.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  private async send(value: T): Promise<void> {
    const sentSeq = this.seq;
    this.inFlight = true;
    this.set({ status: "saving" });
    try {
      const saved = await this.handlers.save(value, this.rev);
      this.rev = saved.rev;
      this.savedSeq = sentSeq;
      this.failures = 0;
      this.inFlight = false;
      this.handlers.onSaved?.(saved);
      if (this.disposed) return;
      if (this.seq !== this.savedSeq) {
        // Typed more while this save was in flight: send that next (its own debounce has usually passed already).
        this.set({ status: "pending" });
        if (!this.timer) this.flush();
      } else {
        this.set({ status: "saved" });
      }
    } catch (err) {
      this.inFlight = false;
      if (this.disposed) return;
      this.failed(err);
    }
  }

  private failed(err: unknown): void {
    const status = err instanceof ApiClientError ? err.status : 500;
    const message = err instanceof ApiClientError ? err.message : "Couldn't save. Trying again…";
    if (status === 412 && err instanceof ApiClientError && err.code === "PRECONDITION_FAILED") {
      this.clearTimer();
      this.set({ status: "conflict", conflict: err.details[0]?.current as R | undefined });
    } else if (status === 409 || status === 404 || status === 401) {
      this.clearTimer();
      this.set({ status: "error", error: message, stopped: true });
    } else if (status === 400 || status === 413 || status === 415) {
      this.set({ status: "error", error: message }); // the next change tries again
    } else {
      // Offline (status 0) or the server is having trouble: back off and try again.
      const delays = this.opts.retryDelaysMs ?? RETRY_DELAYS_MS;
      this.schedule(delays[Math.min(this.failures, delays.length - 1)]);
      this.failures++;
      this.set(status === 0 ? { status: "offline" } : { status: "error", error: message });
    }
  }

  private schedule(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private set(state: AutosaveState<R>): void {
    this.state = state;
    this.opts.onState(state);
  }
}
