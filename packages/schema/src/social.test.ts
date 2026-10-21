import { describe, expect, it } from "vitest";
import { checkHashtag, countChars, hashtagErrors, hashtagHint, normalizeHashtag, normalizeHashtags, postedText, socialCounts, socialProblems } from "./social";

const ok = { caption: "Why is the sky blue? 🌅", hashtags: ["#science", "#physics"], coverText: "Why blue?" };

describe("social rules (F3.4)", () => {
  it("counts characters like Instagram: Hindi and emoji count per character", () => {
    expect(countChars("विज्ञान")).toBe(7);
    expect(countChars("🌅🌅")).toBe(2);
  });

  it("normalises hashtags: # added, spaces and stray # removed, Unicode kept, duplicates dropped", () => {
    expect(normalizeHashtag("science")).toBe("#science");
    expect(normalizeHashtag("# sky blue")).toBe("#skyblue");
    expect(normalizeHashtag("##CBSE")).toBe("#CBSE");
    expect(normalizeHashtag("विज्ञान")).toBe("#विज्ञान");
    expect(normalizeHashtag("#!!")).toBeNull();
    expect(normalizeHashtags(["science", "#Science", "", "physics"])).toEqual(["#science", "#physics"]);
  });

  it("refuses what Instagram wouldn't keep, with a reason, instead of changing it (QA)", () => {
    expect(checkHashtag("#a-b")).toEqual({ error: expect.stringMatching(/#a-b can't have "-".*try #a_b/) });
    expect(checkHashtag("#123")).toEqual({ error: "#123: hashtags need at least one letter" });
    expect(checkHashtag("#" + "a".repeat(100))).toEqual({ error: expect.stringMatching(/longer than 100 characters/) });
    expect(checkHashtag("#" + "a".repeat(99))).toEqual({ tag: "#" + "a".repeat(99) });
    expect(checkHashtag("study with me")).toEqual({ tag: "#studywithme" });
    expect(checkHashtag("  ")).toBeNull();
    expect(normalizeHashtag("#a-b")).toBeNull();
    expect(hashtagErrors(["#ok", "#1", "#a-b"])).toHaveLength(2);
  });

  it("the posted text is the caption, a blank line and the hashtags", () => {
    expect(postedText(ok)).toBe("Why is the sky blue? 🌅\n\n#science #physics");
    expect(postedText({ caption: "", hashtags: ["#a"] })).toBe("#a");
  });

  it("counts hashtags inside the caption too, and @mentions", () => {
    expect(socialCounts({ caption: "Hi #one @asha and @ravi.k", hashtags: ["#two"] })).toMatchObject({ hashtags: 2, mentions: 2 });
    expect(socialCounts({ caption: "mail me@example.com", hashtags: [] }).mentions).toBe(0);
  });

  it("allows exactly the limits and reports each one passed", () => {
    expect(socialProblems(ok)).toEqual([]);
    const tags = Array.from({ length: 30 }, (_, i) => `#t${i}`);
    expect(socialProblems({ ...ok, hashtags: tags })).toEqual([]);
    expect(socialProblems({ ...ok, hashtags: [...tags, "#t30"] })[0]).toMatchObject({ field: "hashtags" });
    expect(socialProblems({ ...ok, caption: "#a ".repeat(1), hashtags: tags })[0].issue).toMatch(/31 hashtags/);
    expect(socialProblems({ ...ok, caption: "x".repeat(2200), hashtags: [] })).toEqual([]);
    expect(socialProblems({ ...ok, caption: "x".repeat(2190), hashtags: ["#abcdefghij"] })[0].issue).toMatch(/2203 characters/);
    expect(socialProblems({ ...ok, caption: Array.from({ length: 21 }, (_, i) => `@u${i}`).join(" ") })[0].issue).toMatch(/21 @mentions/);
  });

  it("cover text: one line, 1–5 words, at most 40 characters", () => {
    expect(socialProblems({ ...ok, coverText: "" })[0]).toMatchObject({ field: "coverText", issue: "is empty" });
    expect(socialProblems({ ...ok, coverText: "one two three four five six" })[0].issue).toMatch(/5 words/);
    expect(socialProblems({ ...ok, coverText: "a\nb" })[0].issue).toMatch(/one line/);
    expect(socialProblems({ ...ok, coverText: "आसमान नीला क्यों है?" })).toEqual([]);
  });

  it("5–15 hashtags is only a hint", () => {
    expect(hashtagHint(4)).toBe("few");
    expect(hashtagHint(10)).toBeNull();
    expect(hashtagHint(16)).toBe("many");
  });
});
