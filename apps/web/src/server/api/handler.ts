import "server-only";
import type { ZodType } from "zod";
import { env } from "../env";
import { ApiError, errorBody } from "./errors";
import { isAllowedOrigin, parseWith, requestIdFrom, sanitize } from "./request";
import { sessionUser, type SessionUser } from "./session";

/**
 * Wrapper for every `/api/v1` route handler (API Design §2–§7). In order, it:
 * 1. gives the request an id (`X-Request-Id`, echoed or generated);
 * 2. checks `Origin` on unsafe methods (CSRF, §3.2);
 * 3. requires a session — and, by default, a verified email (§3.1);
 * 4. checks `Content-Type` and the body size, parses JSON and validates body, query and path params with Zod after
 *    trimming / NFC-normalising strings (§4);
 * 5. runs the handler and returns its data as JSON (`204 No Content` when it returns nothing), or turns any error into the standard error body (§7) —
 *    unexpected errors become `500 INTERNAL` and are logged with the request id, never sent to the client.
 *
 * Request schemas should be strict (`z.strictObject`) so unknown fields are rejected (§2).
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

type Auth = "verified" | "session" | "public";
type UserFor<A extends Auth> = A extends "public" ? SessionUser | null : SessionUser;

export interface RouteOptions<A extends Auth, B, Q, P> {
  /** `verified` (default): signed in with a verified email. `session`: signed in. `public`: no session needed. */
  auth?: A;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  /** Body limit in bytes (default 64 KB, §4). */
  maxBodyBytes?: number;
}

export interface RouteInput<A extends Auth, B, Q, P> {
  req: Request;
  requestId: string;
  user: UserFor<A>;
  body: B;
  query: Q;
  params: P;
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/**
 * JSON `405 METHOD_NOT_ALLOWED` (with `Allow`) for the methods a route file doesn't implement, so they get the
 * standard error body instead of Next's bare 405:
 *   const notAllowed = methodNotAllowed(["GET"]);
 *   export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
 */
export function methodNotAllowed(allowed: string[]) {
  return apiRoute({ auth: "public" }, async ({ requestId }) =>
    json(errorBody(new ApiError("METHOD_NOT_ALLOWED"), requestId), { status: 405, headers: { Allow: allowed.join(", ") } }),
  );
}

/** `201 Created` with a `Location` header (§5.1). */
export function created(data: unknown, location: string): Response {
  return json(data, { status: 201, headers: { Location: location } });
}

/** Reads the body as text, stopping as soon as it passes `limit` bytes (a chunked upload has no Content-Length). */
async function readText(req: Request, limit: number): Promise<string> {
  if (Number(req.headers.get("content-length") ?? "0") > limit) throw new ApiError("PAYLOAD_TOO_LARGE");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBody(req: Request, limit: number): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  const text = await readText(req, limit);
  if (!text.trim()) return {};
  if (!/^application\/json\b/i.test(type)) throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("VALIDATION_FAILED", { details: [{ field: "body", issue: "isn't valid JSON" }] });
  }
}

export function apiRoute<A extends Auth = "verified", B = undefined, Q = undefined, P = undefined>(
  options: RouteOptions<A, B, Q, P>,
  handler: (input: RouteInput<A, B, Q, P>) => Promise<Response | unknown>,
) {
  return async (req: Request, ctx?: RouteContext): Promise<Response> => {
    const requestId = requestIdFrom(req.headers.get("x-request-id"));
    let res: Response;
    try {
      if (UNSAFE.has(req.method) && !isAllowedOrigin(req.headers.get("origin"), [env.appUrl, req.url])) throw new ApiError("ORIGIN_NOT_ALLOWED");

      const mode: Auth = options.auth ?? "verified";
      // No session means null; a failing lookup (database down) is an error in every mode, never "signed out".
      const user = await sessionUser(req.headers);
      if (mode !== "public" && !user) throw new ApiError("UNAUTHENTICATED");
      if (mode === "verified" && !user!.emailVerified) throw new ApiError("EMAIL_NOT_VERIFIED");

      const url = new URL(req.url);
      const query = options.query ? parseWith(options.query, sanitize(Object.fromEntries(url.searchParams)), "query") : (undefined as Q);
      const params = options.params ? parseWith(options.params, sanitize((await ctx?.params) ?? {}), "params") : (undefined as P);
      const body = options.body
        ? parseWith(options.body, sanitize(await readBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)), "body")
        : (undefined as B);

      const result = await handler({ req, requestId, user: user as UserFor<A>, body, query, params });
      // Copy a returned Response: ones from Response.redirect() or fetch() have read-only headers.
      res = result instanceof Response ? new Response(result.body, result) : result === undefined ? new Response(null, { status: 204 }) : json(result);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError("INTERNAL");
      if (!(err instanceof ApiError)) console.error(`[api] ${requestId} ${req.method} ${new URL(req.url).pathname} failed:`, err);
      res = json(errorBody(apiErr, requestId), { status: apiErr.status });
      if (apiErr.retryAfterSec !== null) res.headers.set("Retry-After", String(apiErr.retryAfterSec));
    }
    res.headers.set("X-Request-Id", requestId);
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
}
