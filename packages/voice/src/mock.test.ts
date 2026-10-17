import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTTS } from "./mock";

describe("mock voice", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vz-mock-"));
    vi.stubEnv("MOCK_WPM", ""); // a rate set in the shell must not change the default-rate tests
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const speak = (text: string, extra: { language?: "en" | "hi"; speed?: number } = {}) =>
    createMockTTS().synthesize(text, { language: extra.language ?? "en", speed: extra.speed, outPathNoExt: path.join(dir, "s1") });

  it("times one word per spoken token, in order, without overlaps", async () => {
    const result = await speak("Light bends, then it splits.");
    expect(result.words.map((w) => w.text)).toEqual(["Light", "bends,", "then", "it", "splits."]);
    for (let i = 1; i < result.words.length; i++) expect(result.words[i].startMs).toBeGreaterThanOrEqual(result.words[i - 1].endMs);
    expect(result.durationMs).toBeGreaterThan(result.words[result.words.length - 1].endMs);
    expect(result.timingSource).toBe("estimated");
  });

  it("speaks at about 150 wpm in English and 140 wpm in Hindi", async () => {
    const text = "one two three four five six seven eight nine ten";
    // 10 words: 4 s at 150 wpm, plus 100 ms of tail.
    expect((await speak(text)).durationMs).toBeCloseTo(4100);
    expect((await speak(text, { language: "hi" })).durationMs).toBeCloseTo((10 * 60_000) / 140 + 100);
  });

  it("speeds up with `speed` and follows MOCK_WPM", async () => {
    const text = "one two three four five six seven eight nine ten";
    expect((await speak(text, { speed: 2 })).durationMs).toBeCloseTo(2100);
    vi.stubEnv("MOCK_WPM", "120");
    expect((await speak(text)).durationMs).toBeCloseTo(5100);
  });

  it("writes a silent WAV file of the right length", async () => {
    const result = await speak("one two three four five six seven eight nine ten");
    const wav = await readFile(result.audioPath);
    expect(result.audioPath.endsWith(".wav")).toBe(true);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    // 24 kHz, 16-bit mono: 2 bytes per sample after the 44-byte header.
    expect(wav.length).toBe(44 + Math.ceil((result.durationMs / 1000) * 24_000) * 2);
  });
});
