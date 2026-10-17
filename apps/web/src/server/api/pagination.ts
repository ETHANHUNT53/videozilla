import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { ApiError } from "./errors";

/**
 * Cursor pagination (API Design §6.1): `?limit=1–100 (default 24)&cursor=<opaque>` →
 * `{ items, nextCursor, hasMore }`. The cursor is base64url JSON of the last item's sort value plus its id as a
 * tie-breaker, and a short hash of the filters it was made with, so it can't be replayed against a different list.
 */

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
};

export interface Cursor {
  /** Sort value of the last item (an ISO date for date sorts). */
  u: string;
  /** Id of the last item (tie-breaker). */
  i: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Stable fingerprint of the filters a list was requested with. */
function scopeHash(scope: unknown): string {
  return createHash("sha256").update(JSON.stringify(scope ?? null)).digest("base64url").slice(0, 10);
}

export function encodeCursor(cursor: Cursor, scope?: unknown): string {
  return Buffer.from(JSON.stringify({ ...cursor, f: scopeHash(scope) })).toString("base64url");
}

/** Decodes a cursor made by `encodeCursor` for the same scope; anything else is `400 INVALID_CURSOR`. */
export function decodeCursor(raw: string, scope?: unknown): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("INVALID_CURSOR");
  }
  const c = parsed as Partial<Cursor & { f: string }>;
  const valid =
    typeof c?.u === "string" && !Number.isNaN(Date.parse(c.u)) && typeof c.i === "string" && ObjectId.isValid(c.i) && c.i.length === 24;
  if (!valid || c.f !== scopeHash(scope)) throw new ApiError("INVALID_CURSOR");
  return { u: c.u!, i: c.i! };
}

/**
 * MongoDB filter for "items after the cursor" when sorting by `field` descending, then `_id` descending
 * (e.g. the project library: `-updatedAt`, ties broken by `-id`).
 */
export function afterCursorDesc(field: string, cursor: Cursor) {
  const value = new Date(cursor.u);
  const id = new ObjectId(cursor.i);
  return { $or: [{ [field]: { $lt: value } }, { [field]: value, _id: { $lt: id } }] };
}

/**
 * Builds a page from `limit + 1` fetched rows: the extra row only tells us whether there is more.
 * `cursorOf` gives the sort value and id of a row.
 */
export function toPage<Row, Item>(rows: Row[], limit: number, map: (row: Row) => Item, cursorOf: (row: Row) => Cursor, scope?: unknown): Page<Item> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: kept.map(map),
    nextCursor: hasMore ? encodeCursor(cursorOf(kept[kept.length - 1]), scope) : null,
    hasMore,
  };
}
