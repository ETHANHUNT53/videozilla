import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./errors";
import { afterCursorDesc, decodeCursor, DEFAULT_LIMIT, encodeCursor, pageQuery, toPage } from "./pagination";

const id = new ObjectId().toHexString();
const cursor = { u: "2026-10-16T09:26:30.000Z", i: id };

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as ApiError).code;
  }
};

describe("cursors", () => {
  it("round-trip for the same filters", () => {
    const raw = encodeCursor(cursor, { filter: "drafts", q: "sky" });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, safe in a query string
    expect(decodeCursor(raw, { filter: "drafts", q: "sky" })).toEqual(cursor);
  });

  it("don't depend on the order the filters were written in", () => {
    const raw = encodeCursor(cursor, { filter: "drafts", q: "sky", nested: { b: 1, a: [1, 2] } });
    expect(decodeCursor(raw, { nested: { a: [1, 2], b: 1 }, q: "sky", filter: "drafts" })).toEqual(cursor);
  });

  it("are rejected with different filters, or when not made by us", () => {
    const raw = encodeCursor(cursor, { filter: "drafts" });
    expect(code(() => decodeCursor(raw, { filter: "ready" }))).toBe("INVALID_CURSOR");
    expect(code(() => decodeCursor("not-a-cursor"))).toBe("INVALID_CURSOR");
    expect(code(() => decodeCursor(Buffer.from(JSON.stringify({ u: "yesterday", i: id })).toString("base64url")))).toBe("INVALID_CURSOR");
    expect(code(() => decodeCursor(encodeCursor({ u: cursor.u, i: "123" })))).toBe("INVALID_CURSOR");
  });
});

describe("afterCursorDesc", () => {
  it("selects older items, and items with the same time but a smaller id", () => {
    expect(afterCursorDesc("updatedAt", cursor)).toEqual({
      $or: [{ updatedAt: { $lt: new Date(cursor.u) } }, { updatedAt: new Date(cursor.u), _id: { $lt: new ObjectId(id) } }],
    });
  });
});

describe("toPage", () => {
  const rows = Array.from({ length: 5 }, (_, n) => ({ n, at: new Date(Date.UTC(2026, 9, 16, 0, 0, 10 - n)), _id: new ObjectId() }));
  const of = (r: (typeof rows)[number]) => ({ u: r.at.toISOString(), i: r._id.toHexString() });

  it("uses the extra row only to say there is more", () => {
    const page = toPage(rows, 4, (r) => r.n, of, { filter: "all" });
    expect(page.items).toEqual([0, 1, 2, 3]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor!, { filter: "all" })).toEqual(of(rows[3]));
  });

  it("has no cursor on the last page", () => {
    expect(toPage(rows, 5, (r) => r.n, of)).toEqual({ items: [0, 1, 2, 3, 4], nextCursor: null, hasMore: false });
    expect(toPage([], 24, (r) => r, of)).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});

describe("pageQuery", () => {
  const schema = z.strictObject(pageQuery);

  it("defaults the limit to 24 and coerces it from the query string", () => {
    expect(schema.parse({})).toEqual({ limit: DEFAULT_LIMIT });
    expect(schema.parse({ limit: "10", cursor: "abc" })).toEqual({ limit: 10, cursor: "abc" });
  });

  it("allows 1–100", () => {
    expect(schema.safeParse({ limit: "0" }).success).toBe(false);
    expect(schema.safeParse({ limit: "101" }).success).toBe(false);
    expect(schema.safeParse({ limit: "2.5" }).success).toBe(false);
  });
});
