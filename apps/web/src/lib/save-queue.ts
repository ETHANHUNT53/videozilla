/**
 * Saves changes one at a time, keeping only the newest value of each field that arrives while a save runs (the settings
 * panel, F2.7 QA): a second key press during a save isn't dropped, and holding a key doesn't send a request per press.
 * When the running save ends, the waiting changes go out together in one more save, so the screen, the focus and the
 * server end up agreeing. A save that throws drops what was waiting; `cancel()` does the same on purpose (after a
 * conflict the save handled itself, say).
 */
export function createSaveQueue<T extends object>(save: (changes: Partial<T>) => Promise<void>, onIdle?: () => void) {
  let running = false;
  let waiting: Partial<T> | null = null;

  async function drain() {
    running = true;
    try {
      while (waiting) {
        const batch = waiting;
        waiting = null;
        await save(batch);
      }
    } catch (err) {
      // A failed save drops what was waiting: those values were chosen on top of a state that didn't save.
      waiting = null;
      throw err;
    } finally {
      running = false;
      onIdle?.();
    }
  }

  return {
    /** Adds changes; starts saving unless a save is already running (then they go out after it, newest value wins). */
    push(changes: Partial<T>): Promise<void> {
      waiting = { ...(waiting ?? {}), ...changes };
      return running ? Promise.resolve() : drain();
    },
    /** Drops the changes still waiting (the running save goes on). */
    cancel() {
      waiting = null;
    },
    /** What will be saved next, merged over what's being saved now, for showing it before the server answers. */
    get waiting(): Partial<T> {
      return { ...(waiting ?? {}) };
    },
    get busy(): boolean {
      return running;
    },
  };
}
