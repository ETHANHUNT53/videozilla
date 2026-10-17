import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";
import { clampChars, conflictCopy, patchProject } from "./project-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("patchProject", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends If-Match with the revision the caller saw and splits off requiresRegeneration", async () => {
    const fetchMock = vi.fn(async () => json({ id: "p1", rev: 4, title: "New", requiresRegeneration: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await patchProject<{ id: string; rev: number; title: string }>({ id: "p1", rev: 3 }, { title: "New" });
    expect(result).toEqual({ project: { id: "p1", rev: 4, title: "New" }, requiresRegeneration: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("/api/v1/projects/p1");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ title: "New" }) });
    expect(init.headers["If-Match"]).toBe('"3"');
  });
});

describe("conflictCopy", () => {
  it("returns the current project from a 412 and nothing for other errors", () => {
    const current = { id: "p1", rev: 9 };
    expect(conflictCopy(new ApiClientError(412, "PRECONDITION_FAILED", "x", [{ issue: "stale", current }]))).toEqual(current);
    expect(conflictCopy(new ApiClientError(409, "INVALID_STATE", "x"))).toBeUndefined();
    expect(conflictCopy(new Error("x"))).toBeUndefined();
  });
});

describe("clampChars", () => {
  it("keeps 80 characters counted like the API, never splitting an emoji", () => {
    expect(clampChars("short")).toBe("short");
    expect(Array.from(clampChars("🎬".repeat(90)))).toHaveLength(80);
    expect(clampChars("🎬".repeat(90))).toBe("🎬".repeat(80));
  });
});
