import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { correctedSpeed, plannedSpeed, SCENE_PADDING_SEC, VoiceStats, WINDOWS } from "./fit";

describe("plannedSpeed", () => {
  it("aims for the middle of the window after scene padding", () => {
    // 150 words at 150 wpm = 60 s of speech; goal is 60 s − 5 × 0.52 s = 57.4 s → speed 1.045 → 1.05.
    expect(plannedSpeed(150, 5, 150, 60)).toBe(1.05);
    expect(WINDOWS[60]).toEqual([55, 65]);
    expect(SCENE_PADDING_SEC).toBe(0.52);
  });

  it("uses the 90-second window", () => {
    // 210 words at 140 wpm = 90 s; goal 87.5 − 7 × 0.52 = 83.86 s → 1.073 → 1.07.
    expect(plannedSpeed(210, 7, 140, 90)).toBe(1.07);
  });

  it("stays within the natural-sounding speed range", () => {
    expect(plannedSpeed(400, 5, 150, 60)).toBe(1.18);
    expect(plannedSpeed(40, 5, 150, 60)).toBe(0.85);
  });
});

describe("correctedSpeed", () => {
  it("returns null when the video is inside its window", () => {
    expect(correctedSpeed(55, 5, 1, 60)).toBeNull();
    expect(correctedSpeed(65, 5, 1, 60)).toBeNull();
  });

  it("speeds up a video that ran long and slows down one that ran short", () => {
    // 70 s with 5 scenes = 67.4 s of speech against a 57.4 s goal → 1.17.
    expect(correctedSpeed(70, 5, 1, 60)).toBe(1.17);
    // 50 s → 47.4 / 57.4 → 0.83, clamped to 0.85.
    expect(correctedSpeed(50, 5, 1, 60)).toBe(0.85);
  });

  it("returns null when the speed is already at its limit (re-recording would not help)", () => {
    expect(correctedSpeed(70, 5, 1.18, 60)).toBeNull();
  });
});

describe("VoiceStats", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vz-fit-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("falls back to the language default before any run", async () => {
    const stats = await VoiceStats.load(root);
    expect(stats.wpm("voice-a", "en")).toBe(150);
    expect(stats.wpm("voice-a", "hi")).toBe(140);
  });

  it("learns the rate at speed 1.0 as a running average and saves it", async () => {
    const stats = await VoiceStats.load(root);
    await stats.record("voice-a", 160, 60, 1); // 160 wpm
    expect(stats.wpm("voice-a", "en")).toBe(160);
    await stats.record("voice-a", 132, 60, 1.1); // 132 wpm at 1.1× → 120 wpm at 1.0×
    expect(stats.wpm("voice-a", "en")).toBeCloseTo(140);

    const saved = JSON.parse(await readFile(path.join(root, ".cache", "voice-stats.json"), "utf8"));
    expect(saved["voice-a"]).toEqual({ wpm: expect.closeTo(140), runs: 2 });
    expect((await VoiceStats.load(root)).wpm("voice-a", "en")).toBeCloseTo(140);
  });

  it("weights new runs by at most 1/5 once it has history", async () => {
    const stats = await VoiceStats.load(root);
    for (let i = 0; i < 5; i++) await stats.record("v", 150, 60, 1);
    await stats.record("v", 200, 60, 1);
    expect(stats.wpm("v", "en")).toBeCloseTo(160);
  });

  it("ignores runs without speech", async () => {
    const stats = await VoiceStats.load(root);
    await stats.record("v", 100, 0, 1);
    expect(stats.wpm("v", "en")).toBe(150);
  });
});
