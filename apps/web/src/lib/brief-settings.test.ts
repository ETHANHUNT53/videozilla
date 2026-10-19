import { describe, expect, it } from "vitest";
import { briefSettingsChange } from "./brief-settings";

/** F2.6 follow-up: the brief card's "the video changed" bar. */

describe("briefSettingsChange", () => {
  it("nothing when the brief matches the video, or doesn't say what it was written for (older briefs)", () => {
    expect(briefSettingsChange({ language: "en", lengthSec: 60 }, { language: "en", lengthSec: 60 })).toBeNull();
    expect(briefSettingsChange({ language: null, lengthSec: null }, { language: "hi", lengthSec: 90 })).toBeNull();
  });

  it("a language change: 'Regenerate brief in Hindi'", () => {
    expect(briefSettingsChange({ language: "en", lengthSec: 60 }, { language: "hi", lengthSec: 60 })).toEqual({
      message: "This brief is in English; the video is now in Hindi.",
      action: "Regenerate brief in Hindi",
      key: "hi-60",
    });
  });

  it("a length change, and both at once", () => {
    expect(briefSettingsChange({ language: "en", lengthSec: 60 }, { language: "en", lengthSec: 90 })).toMatchObject({
      message: "This brief is for about 60 seconds; the video is now 90.",
      action: "Update the brief for 90 seconds",
    });
    expect(briefSettingsChange({ language: "hi", lengthSec: 90 }, { language: "en", lengthSec: 60 })).toMatchObject({
      message: "This brief is in Hindi for about 90 seconds; the video is now in English, 60 seconds.",
      action: "Regenerate brief in English for 60 seconds",
      key: "en-60",
    });
  });
});
