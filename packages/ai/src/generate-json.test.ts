import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { AiBusyError, AiOutputError, generateJson, type AiCallLog } from "./generate-json";

const Shape = z.object({ items: z.array(z.string()).length(2) });
const reply = (data: unknown, tokens = { promptTokenCount: 10, candidatesTokenCount: 5 }) => ({ text: typeof data === "string" ? data : JSON.stringify(data), usageMetadata: tokens });
const busy = () => new Error("503 UNAVAILABLE: The model is overloaded due to high demand");

async function run(deadlineMs?: number) {
  const logs: AiCallLog[] = [];
  const promise = generateJson({ system: "sys", prompt: "user prompt", schema: Shape, deadlineMs, onCall: (l) => void logs.push(l) });
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return { promise, logs };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_FAST_MODEL", "");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
  generateContent.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("generateJson", () => {
  it("returns schema-valid JSON from the fast model, with the system prompt and JSON mode, and logs the call", async () => {
    generateContent.mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise, logs } = await run();
    await expect(promise).resolves.toEqual({ data: { items: ["a", "b"] }, model: "gemini-3.8-flash" });
    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-3.8-flash");
    expect(req.config).toMatchObject({ systemInstruction: "sys", responseMimeType: "application/json" });
    expect(logs).toEqual([{ model: "gemini-3.8-flash", status: "ok", latencyMs: expect.any(Number), inputTokens: 10, outputTokens: 5 }]);
  });

  it("busy: retries the fast model once, then uses the fallback model", async () => {
    generateContent.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ model: "gemini-3.5-flash-lite" });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    expect(logs.map((l) => l.status)).toEqual(["retry", "retry", "fallback"]);
  });

  it("busy on every model: AiBusyError", async () => {
    generateContent.mockRejectedValue(busy());
    const { promise } = await run();
    await expect(promise).rejects.toBeInstanceOf(AiBusyError);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("models that never answer: the whole call stays inside the deadline, then AiBusyError", async () => {
    generateContent.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const { promise } = await run(15_000);
    await expect(promise).rejects.toBeInstanceOf(AiBusyError);
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    // A slow main model isn't tried twice: main (11 s), then the fallback in the 4 s kept for it.
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it("a slow main model leaves time for the fallback, which answers inside the deadline", async () => {
    generateContent.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const started = Date.now();
    const { promise, logs } = await run(15_000);
    await expect(promise).resolves.toMatchObject({ model: "gemini-3.5-flash-lite" });
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    expect(logs.map((l) => [l.status, l.latencyMs])).toEqual([["retry", 11_000], ["fallback", expect.any(Number)]]);
  });

  it("asks gemini-3.8-flash for low thinking (it's slow otherwise); other models get the API defaults", async () => {
    generateContent.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    await (await run()).promise;
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(generateContent.mock.calls[2][0].config.thinkingConfig).toBeUndefined();
  });

  it("a non-busy error (e.g. a bad key) is thrown at once", async () => {
    generateContent.mockRejectedValueOnce(new Error("400 INVALID_ARGUMENT: API key not valid"));
    const { promise } = await run();
    await expect(promise).rejects.toThrow("API key not valid");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("repairs once: sends the schema errors back and accepts the fixed reply", async () => {
    generateContent.mockResolvedValueOnce(reply({ items: ["only one"] })).mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise } = await run();
    await expect(promise).resolves.toMatchObject({ data: { items: ["a", "b"] } });
    const contents = generateContent.mock.calls[1][0].contents as { role: string; parts: { text: string }[] }[];
    expect(contents.at(-1)!.parts[0].text).toMatch(/did not match the required shape: items/);
  });

  it("invalid JSON twice: AiOutputError", async () => {
    generateContent.mockResolvedValue(reply("not json"));
    const { promise } = await run();
    await expect(promise).rejects.toBeInstanceOf(AiOutputError);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("uses the model names from the environment", async () => {
    vi.stubEnv("GEMINI_FAST_MODEL", "fast-x");
    generateContent.mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise } = await run();
    await expect(promise).resolves.toMatchObject({ model: "fast-x" });
  });

  it("needs GEMINI_API_KEY", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateJson({ system: "s", prompt: "p", schema: Shape })).rejects.toThrow(/GEMINI_API_KEY is missing/);
  });
});
