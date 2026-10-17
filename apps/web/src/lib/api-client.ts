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

export async function apiCall<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiClientError(0, "NETWORK", "Couldn't reach Videozilla. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.error;
    throw new ApiClientError(res.status, error?.code ?? "INTERNAL", error?.message ?? "Something went wrong. Please try again.", error?.details ?? []);
  }
  return { data: body as T, headers: res.headers };
}
