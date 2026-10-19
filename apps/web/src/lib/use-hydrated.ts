import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False in the server HTML and until React has hydrated in the browser, then true. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
