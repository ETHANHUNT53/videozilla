import { describe, expect, it } from "vitest";
import { normalizeToken, prepareForSpeech, similarity, tokenize } from "./text";

describe("tokenize", () => {
  it("splits on any whitespace and drops punctuation-only tokens", () => {
    expect(tokenize("  Light  bends —\nthen   splits! ")).toEqual(["Light", "bends", "then", "splits!"]);
  });

  it("keeps Devanagari words (with their combining marks) whole and drops a lone danda", () => {
    expect(tokenize("पौधे सूरज की रोशनी से खाना बनाते हैं ।")).toEqual(["पौधे", "सूरज", "की", "रोशनी", "से", "खाना", "बनाते", "हैं"]);
  });

  it("normalises to NFC so decomposed and composed text give the same tokens", () => {
    expect(tokenize("café")).toEqual(tokenize("café"));
  });
});

describe("normalizeToken", () => {
  it("lowercases and strips punctuation, quotes and the Hindi danda", () => {
    expect(normalizeToken("“Sunlight,”")).toBe("sunlight");
    expect(normalizeToken("हैं।")).toBe("हैं");
    expect(normalizeToken("*rainbow*")).toBe("rainbow");
  });
});

describe("similarity", () => {
  it("is 1 for equal strings and 0 when one is empty", () => {
    expect(similarity("light", "light")).toBe(1);
    expect(similarity("", "light")).toBe(0);
  });

  it("scores one edit in a 7-letter word above the 0.8 match threshold", () => {
    expect(similarity("rainbow", "rainbo")).toBeCloseTo(6 / 7);
    expect(similarity("rainbow", "rainbow")).toBeGreaterThan(0.8);
  });

  it("scores unrelated words low", () => {
    expect(similarity("ocean", "light")).toBeLessThan(0.5);
  });
});

describe("prepareForSpeech", () => {
  it("removes emoji and collapses whitespace", () => {
    expect(prepareForSpeech("Sunsets 🌅 are   orange 🔥\n because")).toBe("Sunsets are orange because");
  });
});
