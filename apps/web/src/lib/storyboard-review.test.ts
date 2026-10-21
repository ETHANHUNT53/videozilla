import { mockStoryboard } from "@videozilla/ai";
import { validateStoryboard } from "@videozilla/pipeline";
import { RawStoryboard } from "@videozilla/schema";
import { describe, expect, it } from "vitest";
import { reviewModel } from "./storyboard-review";

const board = (language: "en" | "hi", lengthSec: 60 | 90) =>
  validateStoryboard(
    RawStoryboard.parse(mockStoryboard({ brief: { title: "Why the sky is blue", hook: "Why blue?", angle: "Light", keyPoints: ["Sunlight", "Scattering", "Sunsets"], outOfScope: [] }, language, lengthSec, audience: "students" })),
    language,
    lengthSec,
  ).storyboard;

describe("reviewModel (F3.3)", () => {
  it("one card per scene, labelled, timed back to back, with chapter headings on each chapter's first scene", () => {
    const sb = board("en", 60);
    const { cards, timeline } = reviewModel(sb, "midnight", 60);
    expect(cards).toHaveLength(sb.scenes.length);
    expect(cards[0]).toMatchObject({ label: "S1 · HOOK", type: "TitleHook", chapterHeading: null });
    expect(cards[0].range.startsWith("00:00 – ")).toBe(true);
    expect(cards.at(-1)!.label).toBe("S8 · RECAP");
    expect(cards.filter((c) => c.chapterHeading).map((c) => c.chapterHeading!.index)).toEqual([1, 2, 3]);
    expect(cards.every((c) => /^~\d+s$/.test(c.length))).toBe(true);
    expect(cards[1].onScreen.length).toBeGreaterThan(0);
    expect(timeline.styleId).toBe("midnight");
  });

  it("the duration guard: inside 55–65 s is fine; outside says long or short (and 80–95 s for 90 s)", () => {
    expect(reviewModel(board("en", 60), "midnight", 60).durationOff).toBeNull();
    expect(reviewModel(board("en", 60), "midnight", 70).durationOff).toBe("long");
    expect(reviewModel(board("en", 60), "midnight", 50).durationOff).toBe("short");
    expect(reviewModel(board("hi", 90), "midnight", 90).durationOff).toBeNull();
    expect(reviewModel(board("hi", 90), "midnight", 100).durationOff).toBe("long");
  });

  it("an unknown theme id still builds (the renderer falls back to Midnight)", () => {
    expect(reviewModel(board("en", 60), "retired-theme", 60).timeline.styleId).toBe("retired-theme");
  });
});
