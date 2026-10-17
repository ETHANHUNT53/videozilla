/**
 * Browser-side calls to `/api/v1` (API Design §5, §7). Sends and expects JSON, and turns the standard error body into
 * an `ApiClientError` whose `message` is safe to show the user. Safe to import from client components.
 */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { field?: string; issue: string; [key: string]: unknown }[] = [],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Browsers refuse `keepalive` requests with bodies over 64 KB; stay under it with room for the headers. */
const KEEPALIVE_MAX_BODY_BYTES = 60 * 1024;

export async function apiCall<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; keepalive?: boolean } = {},
): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  const requestBody = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }), ...init.headers },
      body: requestBody,
      // keepalive: the request still goes out if the page is closed or hidden meanwhile (autosave). Larger bodies
      // can't use it; they are sent normally.
      ...(init.keepalive && new TextEncoder().encode(requestBody ?? "").length <= KEEPALIVE_MAX_BODY_BYTES && { keepalive: true }),
    });
  } catch {
    throw new ApiClientError(0, "NETWORK", "Couldn't reach Videozilla. Check your connection and try again.");
  }
  if (res.status === 401) {
    // Signed out meanwhile (e.g. a password reset elsewhere): sign in again and come back to this page. Callers still
    // get an error so they stop; the page is already navigating away.
    // A full page load on purpose: this helper has no router, and a lost session should reset all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiClientError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.error;
    throw new ApiClientError(res.status, error?.code ?? "INTERNAL", error?.message ?? "Something went wrong. Please try again.", error?.details ?? []);
  }
  return { data: body as T, headers: res.headers };
}
