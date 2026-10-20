/**
 * Opens the Library after the Welcome screen (F1.12) with a full page load, not a client-side navigation.
 *
 * Why (QA, 2026-10-20: "Skip shows a blank screen until I refresh"): right after sign-up the page navigates to
 * /library on the client, and the proxy redirects that request to /welcome. The client router remembers that answer
 * for /library, so a later `router.replace("/library")` replays the old redirect and fetches /welcome instead; Welcome
 * now sends a finished user back to /library, and the two bounce until the browser throttles the navigation and the
 * page stays blank. A full load asks the server afresh (onboarding is now done) and drops that stale memory.
 */
export function openLibrary(location: Pick<Location, "replace"> = window.location): void {
  location.replace("/library");
}
