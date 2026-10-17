import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { ApiError, type ErrorDetail } from "./errors";

/** Echo the client's X-Request-Id when it's safe (≤ 64 chars of [A-Za-z0-9-]); otherwise make one (API Design §2). */
export function requestIdFrom(header: string | null): string {
  return header && /^[A-Za-z0-9-]{1,64}$/.test(header) ? header : `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** CSRF check for unsafe methods (API Design §3.2): the Origin header must be the app's own origin. */
export function isAllowedOrigin(origin: string | null, appUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

// Control characters other than \t and \n (and \r, which is normalised to \n).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Input hygiene (API Design §4): every string is NFC-normalised and trimmed, and control characters are rejected.
 * Runs on parsed JSON bodies and query parameters before the Zod schema.
 */
export function sanitize(value: unknown, path = ""): unknown {
  if (typeof value === "string") {
    if (CONTROL.test(value)) throw new ApiError("VALIDATION_FAILED", { details: [{ field: path || undefined, issue: "contains control characters" }] });
    return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  }
  if (Array.isArray(value)) return value.map((v, i) => sanitize(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, path ? `${path}.${k}` : k)]));
  }
  return value;
}

/** Parses with a Zod schema, turning failures into 400 VALIDATION_FAILED with field-level details. */
export function parseWith<T>(schema: ZodType<T>, value: unknown, where: "body" | "query" | "params"): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details: ErrorDetail[] = result.error.issues.slice(0, 20).map((issue) => {
    const field = issue.path.map(String).join(".");
    return { field: field || where, issue: issue.message };
  });
  throw new ApiError("VALIDATION_FAILED", { details });
}
