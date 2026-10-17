import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./errors";
import { isAllowedOrigin, parseWith, requestIdFrom, sanitize } from "./request";

describe("requestIdFrom", () => {
  it("echoes a safe client id and generates one otherwise", () => {
    expect(requestIdFrom("abc-123")).toBe("abc-123");
    expect(requestIdFrom(null)).toMatch(/^req_[0-9a-f]{16}$/);
    expect(requestIdFrom("bad id with spaces")).toMatch(/^req_/);
    expect(requestIdFrom("x".repeat(65))).toMatch(/^req_/);
  });
});

describe("isAllowedOrigin", () => {
  const APP = ["http://localhost:3000"];

  it("accepts only the app's own origin", () => {
    expect(isAllowedOrigin("http://localhost:3000", APP)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", ["http://localhost:3000/some/path"])).toBe(true);
    expect(isAllowedOrigin("https://evil.example", APP)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3001", APP)).toBe(false);
    expect(isAllowedOrigin(null, APP)).toBe(false);
    expect(isAllowedOrigin("null", APP)).toBe(false);
  });

  it("also accepts the origin the request was sent to (127.0.0.1 in dev, preview deploys)", () => {
    const allowed = ["https://videozilla.in", "http://127.0.0.1:3000/api/v1/projects"];
    expect(isAllowedOrigin("http://127.0.0.1:3000", allowed)).toBe(true);
    expect(isAllowedOrigin("https://videozilla.in", allowed)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", ["not a url"])).toBe(false);
  });
});

describe("sanitize", () => {
  it("trims, NFC-normalises and unifies line breaks in every string, however deep", () => {
    const decomposed = "café";
    expect(sanitize({ title: "  Hi  ", tags: [" a ", decomposed], nested: { notes: "line 1\r\nline 2\r" }, n: 5, ok: true, none: null })).toEqual({
      title: "Hi",
      tags: ["a", "café"],
      nested: { notes: "line 1\nline 2" },
      n: 5,
      ok: true,
      none: null,
    });
  });

  it("keeps tabs and new lines but rejects other control characters, naming the field", () => {
    expect(sanitize("a\tb\nc")).toBe("a\tb\nc");
    try {
      sanitize({ idea: { notes: ["fine", "bell\u0007"] } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("VALIDATION_FAILED");
      expect((err as ApiError).details).toEqual([{ field: "idea.notes[1]", issue: "contains control characters" }]);
    }
  });

  it("keeps Hindi text intact", () => {
    expect(sanitize("  प्रकाश संश्लेषण  ")).toBe("प्रकाश संश्लेषण");
  });
});

describe("parseWith", () => {
  const schema = z.strictObject({ title: z.string().min(1).max(80), lengthPreset: z.union([z.literal(60), z.literal(90)]).optional() });

  it("returns parsed data", () => {
    expect(parseWith(schema, { title: "Sky" }, "body")).toEqual({ title: "Sky" });
  });

  it("turns failures into VALIDATION_FAILED with one detail per field, rejecting unknown keys", () => {
    try {
      parseWith(schema, { title: "", lengthPreset: 70, colour: "red" }, "body");
      expect.unreachable();
    } catch (err) {
      const e = err as ApiError;
      expect(e.code).toBe("VALIDATION_FAILED");
      expect(e.status).toBe(400);
      expect(e.details.map((d) => d.field).sort()).toEqual(["body", "lengthPreset", "title"]);
    }
  });
});
