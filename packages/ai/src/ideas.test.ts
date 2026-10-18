import { describe, expect, it } from "vitest";
import { IdeaBriefReply } from "./brief";
import { IdeaSuggestionsReply } from "./ideas";

const brief = { title: "Why leaves fall", hook: "Trees drop leaves on purpose.", angle: "A tree saving water", audience: "students", keyPoints: ["aa", "bb", "cc"] };

describe("refusalOr (the idea and brief reply schemas)", () => {
  it("reads a refusal; an unknown or missing category is 'other'", () => {
    expect(IdeaBriefReply.parse({ refused: true, category: "illegal" })).toEqual({ refused: true, category: "illegal" });
    expect(IdeaSuggestionsReply.parse({ refused: true, category: "nonsense", reason: "x" })).toEqual({ refused: true, category: "other", reason: "x" });
    expect(IdeaSuggestionsReply.parse({ refused: true })).toMatchObject({ category: "other" });
  });

  it("reads the result, with defaults applied", () => {
    expect(IdeaBriefReply.parse({ brief, alternatives: [brief, brief] })).toEqual({ brief: { ...brief, outOfScope: [] }, alternatives: [{ ...brief, outOfScope: [] }, { ...brief, outOfScope: [] }] });
  });

  it("reports the result's own field errors (what the repair round tells Gemini), not just 'invalid input'", () => {
    const res = IdeaBriefReply.safeParse({ brief: { ...brief, audience: "aliens", keyPoints: ["aa"] }, alternatives: [brief] });
    expect(res.success).toBe(false);
    expect(res.error!.issues.map((i) => i.path.join("."))).toEqual(["brief.audience", "brief.keyPoints", "alternatives"]);
  });
});
