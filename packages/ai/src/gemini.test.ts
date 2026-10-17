import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { generateStoryboard } from "./gemini";
import { storyboardSystemPrompt, storyboardUserPrompt } from "./prompt";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schema/fixtures/sky-blue.en.json");
/** A real English 60 s storyboard: 146 words, inside the 125–150 budget. */
const GOOD = readFileSync(FIXTURE, "utf8");
const SHORT = JSON.stringify({ ...JSON.parse(GOOD), scenes: JSON.parse(GOOD).scenes.slice(0, 3) });

const reply = (text: string) => ({ text });
const busy = () => new Error("503 UNAVAILABLE: The model is overloaded due to high demand");
const REQ = { topic: "Why is the sky blue?", language: "en" as const, targetSec: 60 as const, audience: "class 10" };

/** Runs generateStoryboard while fast-forwarding its retry back-off timers. */
async function run() {
  const promise = generateStoryboard(REQ);
  promise.catch(() => {}); // handled by the caller's expect
  await vi.runAllTimersAsync();
  return promise;
}

/** Text of the last user turn sent to Gemini. */
const lastUserText = () => {
  const contents = generateContent.mock.lastCall![0].contents as { role: string; parts: { text: string }[] }[];
  return contents.filter((c) => c.role === "user").at(-1)!.parts[0].text;
};

describe("generateStoryboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    generateContent.mockReset();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a valid storyboard on the first try with the default model and prompts", async () => {
    generateContent.mockResolvedValueOnce(reply(GOOD));
    const result = await run();
    expect(result).toMatchObject({ attempts: 1, model: "gemini-3.8-flash" });
    expect(result.raw.title).toBe("Why Is the Sky Blue?");
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-3.8-flash");
    expect(call.config).toMatchObject({ systemInstruction: storyboardSystemPrompt("en", 60), responseMimeType: "application/json" });
    expect(call.contents[0].parts[0].text).toBe(storyboardUserPrompt(REQ.topic, REQ.audience));
  });

  it("needs an API key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(run()).rejects.toThrow("GEMINI_API_KEY is missing");
  });

  it("retries a busy model with back-off", async () => {
    generateContent.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce(reply(GOOD));
    const result = await run();
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(result.model).toBe("gemini-3.8-flash");
  });

  it("switches to the fallback model after 4 busy answers", async () => {
    for (let i = 0; i < 4; i++) generateContent.mockRejectedValueOnce(busy());
    generateContent.mockResolvedValueOnce(reply(GOOD));
    const result = await run();
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual([...Array(4).fill("gemini-3.8-flash"), "gemini-3.5-flash-lite"]);
    expect(result.model).toBe("gemini-3.5-flash-lite");
  });

  it("gives up after both models stay busy", async () => {
    generateContent.mockRejectedValue(busy());
    await expect(run()).rejects.toThrow("high demand");
    expect(generateContent).toHaveBeenCalledTimes(8);
  });

  it("does not retry errors that are not about load", async () => {
    generateContent.mockRejectedValue(new Error("400 INVALID_ARGUMENT: API key not valid"));
    await expect(run()).rejects.toThrow("API key not valid");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("asks again when the reply is not JSON", async () => {
    generateContent.mockResolvedValueOnce(reply("Sure! Here is your storyboard:")).mockResolvedValueOnce(reply(GOOD));
    const result = await run();
    expect(result.attempts).toBe(2);
    expect(lastUserText()).toBe("Response was not valid JSON. Return only the JSON object.");
  });

  it("sends the schema errors back when the JSON has the wrong shape", async () => {
    generateContent.mockResolvedValueOnce(reply(JSON.stringify({ title: "Sky" }))).mockResolvedValueOnce(reply(GOOD));
    const result = await run();
    expect(result.attempts).toBe(2);
    expect(lastUserText()).toMatch(/^The JSON did not match the required shape: .*hook.*Fix it and return the full corrected JSON only\.$/);
  });

  it("fails after 3 unusable replies", async () => {
    generateContent.mockResolvedValue(reply("not json"));
    await expect(run()).rejects.toThrow("Gemini did not return a valid storyboard after 3 attempts: Response was not valid JSON.");
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("asks once to expand a script that is far under the word budget, then accepts the next valid reply", async () => {
    generateContent.mockResolvedValueOnce(reply(SHORT)).mockResolvedValueOnce(reply(SHORT));
    const result = await run();
    expect(result.attempts).toBe(2);
    expect(result.raw.scenes).toHaveLength(3);
    expect(lastUserText()).toMatch(/^The total narration is \d+ words, but it must be 125-150 words for a 60-second video\. Expand it/);
  });
});

describe("storyboard prompt", () => {
  it("states the word budget for the language and length", () => {
    expect(storyboardSystemPrompt("en", 60)).toContain("total narration must be 125-150 words");
    expect(storyboardSystemPrompt("hi", 90)).toContain("total narration must be 175-210 words");
    expect(storyboardSystemPrompt("hi", 90)).toContain("HINDI using Devanagari script");
  });
});
