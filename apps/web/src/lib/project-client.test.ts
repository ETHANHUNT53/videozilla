import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";
import { clampChars, conflictCopy, currentNote, patchProject, stripControlChars } from "./project-client";

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

describe("currentNote", () => {
  it("shows a note only while the project is at the revision it was written about", () => {
    const note = { value: "This video was changed in another tab, so your rename wasn't saved. Try again.", rev: 3 };
    expect(currentNote(note, { rev: 3, status: "idea_draft" })).toBe(note.value);
    expect(currentNote(note, { rev: 4, status: "idea_draft" })).toBeNull(); // a later save moved the project on
    expect(currentNote(null, { rev: 3, status: "idea_draft" })).toBeNull();
  });

  it("works for structured messages too", () => {
    const saved = { value: { tone: "info", text: "Saved." }, rev: 5 };
    expect(currentNote(saved, { rev: 5, status: "storyboard_ready" })).toEqual({ tone: "info", text: "Saved." });
    expect(currentNote(saved, { rev: 6, status: "storyboard_ready" })).toBeNull();
  });

  it("keeps a hint tied to a status through unrelated saves, until the stage changes", () => {
    const hint = { value: "Saved. Regenerate the storyboard to use the new settings.", rev: 5, status: "storyboard_ready" };
    expect(currentNote(hint, { rev: 6, status: "storyboard_ready" })).toBe(hint.value); // e.g. renamed afterwards
    expect(currentNote(hint, { rev: 7, status: "storyboard_generating" })).toBeNull(); // regenerating now
  });
});

describe("clampChars", () => {
  it("keeps 80 characters counted like the API, never splitting an emoji", () => {
    expect(clampChars("short")).toBe("short");
    expect(Array.from(clampChars("🎬".repeat(90)))).toHaveLength(80);
    expect(clampChars("🎬".repeat(90))).toBe("🎬".repeat(80));
  });
});

describe("stripControlChars", () => {
  it("turns page breaks and vertical tabs into new lines, drops the other characters the API rejects, keeps tabs, new lines and Hindi", () => {
    expect(stripControlChars("Chapter 1\fPhotosynthesis\u0000\u0007\u007F")).toBe("Chapter 1\nPhotosynthesis");
    expect(stripControlChars("Page one\fPage two\vend")).toBe("Page one\nPage two\nend");
    expect(stripControlChars("a\tb\nc\r\nd")).toBe("a\tb\nc\r\nd");
    expect(stripControlChars("प्रकाश संश्लेषण 🌱")).toBe("प्रकाश संश्लेषण 🌱");
  });
});
