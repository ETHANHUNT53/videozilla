import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { AiBlockedError, AiBusyError, AiOutputError, generateJson, quotaCooldownMs, resetModelCooldowns, type AiCallLog } from "./generate-json";

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
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_FAST_MODEL", "");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
  generateContent.mockReset();
  resetModelCooldowns();
});
afterEach(() => vi.useRealTimers());

describe("generateJson", () => {
  it("returns schema-valid JSON from the fast model, with the system prompt and JSON mode, and logs the call", async () => {
    generateContent.mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise, logs } = await run();
    await expect(promise).resolves.toEqual({ data: { items: ["a", "b"] }, model: "gemini-3.8-flash", provider: "gemini" });
    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-3.8-flash");
    expect(req.config).toMatchObject({ systemInstruction: "sys", responseMimeType: "application/json" });
    expect(logs).toEqual([{ provider: "gemini", model: "gemini-3.8-flash", status: "ok", latencyMs: expect.any(Number), inputTokens: 10, outputTokens: 5 }]);
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

  it("a blocked prompt or reply: AiBlockedError at once (no repair round, no retry, no fallback)", async () => {
    for (const blocked of [
      { text: undefined, promptFeedback: { blockReason: "SAFETY" }, candidates: [] },
      { text: "", candidates: [{ finishReason: "PROHIBITED_CONTENT" }] },
    ]) {
      generateContent.mockReset().mockResolvedValueOnce(blocked);
      const { promise, logs } = await run();
      await expect(promise).rejects.toBeInstanceOf(AiBlockedError);
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(logs).toEqual([expect.objectContaining({ status: "failed", error: expect.stringMatching(/^blocked: /) })]);
    }
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

/** Gemini's real free-tier daily-quota error (2026-10-17), shortened. */
const quotaError = (retryDelay = "35237s") =>
  Object.assign(
    new Error(
      `{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.\\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${retryDelay}"}]}}`,
    ),
    { status: 429 },
  );

describe("RECITATION (repeating existing text) is an unusable reply, not a safety block", () => {
  it("retries once with 'use your own words' added to the request, and accepts the new reply", async () => {
    generateContent.mockResolvedValueOnce({ text: "", candidates: [{ finishReason: "RECITATION" }] }).mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ data: { items: ["a", "b"] } });
    const contents = generateContent.mock.calls[1][0].contents as { role: string; parts: { text: string }[] }[];
    expect(contents.map((c) => c.role)).toEqual(["user"]); // turns still alternate
    expect(contents[0].parts[0].text).toMatch(/^user prompt\n\nYour reply was stopped because it repeated existing text/);
    expect(logs[0]).toMatchObject({ status: "failed", error: "recitation" });
  });

  it("recitation twice: AiOutputError (the app answers 503 and gives the request back), never AiBlockedError", async () => {
    generateContent.mockResolvedValue({ text: "", candidates: [{ finishReason: "RECITATION" }] });
    const { promise } = await run();
    await expect(promise).rejects.toBeInstanceOf(AiOutputError);
    await expect(promise).rejects.not.toBeInstanceOf(AiBlockedError);
  });
});

describe("quota circuit breaker", () => {
  it("reads the cooldown from Gemini's retryDelay; daily quotas without one wait 30 min; other errors aren't quota errors", () => {
    expect(quotaCooldownMs(quotaError("35237s"))).toBe(35_237_000);
    expect(quotaCooldownMs(quotaError("2.5s"))).toBe(10_000); // at least 10 s
    expect(quotaCooldownMs(new Error("You exceeded your current quota … GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).toBe(30 * 60_000);
    expect(quotaCooldownMs(new Error("Quota exceeded for metric: …per minute"))).toBe(60_000);
    expect(quotaCooldownMs(busy())).toBeNull();
    expect(quotaCooldownMs(new Error("429 RESOURCE_EXHAUSTED: Resource has been exhausted"))).toBeNull();
  });

  it("a key out of prepaid credits (402) is skipped for 30 min on every model, without three failed calls per request", async () => {
    const depleted = () => new Error('{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing."}}');
    expect(quotaCooldownMs(depleted())).toBe(30 * 60_000);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockRejectedValue(depleted());
    const first = await run();
    await expect(first.promise).rejects.toBeInstanceOf(AiBusyError);
    // Main model once (no second try), then the fallback once: both now cool down.
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/prepaid credits are used up/));
    generateContent.mockClear();
    const again = await run();
    await expect(again.promise).rejects.toMatchObject({ name: "AiBusyError", retryAfterSec: 1800 });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("a quota error goes straight to the fallback (no retry of the main model), with the fallback's full time", async () => {
    generateContent.mockRejectedValueOnce(quotaError()).mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ model: "gemini-3.5-flash-lite" });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    expect(logs[0]).toMatchObject({ status: "retry", error: expect.stringMatching(/exceeded your current quota/) });
  });

  it("later requests skip the out-of-quota model entirely until the cooldown ends", async () => {
    generateContent.mockRejectedValueOnce(quotaError("600s")).mockResolvedValue(reply({ items: ["a", "b"] }));
    await (await run()).promise;
    generateContent.mockClear();
    await expect((await run()).promise).resolves.toMatchObject({ model: "gemini-3.5-flash-lite" });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["gemini-3.5-flash-lite"]);

    vi.advanceTimersByTime(601_000);
    generateContent.mockClear();
    await (await run()).promise;
    expect(generateContent.mock.calls[0][0].model).toBe("gemini-3.8-flash"); // back after the cooldown
  });

  it("logs a skipped (out-of-quota) model once per request, so the call log shows why the fallback was used", async () => {
    generateContent.mockRejectedValueOnce(quotaError("600s")).mockResolvedValue(reply({ items: ["a", "b"] }));
    await (await run()).promise;
    const { promise, logs } = await run();
    await promise;
    expect(logs.map((l) => [l.model, l.status, l.error?.split(" until")[0]])).toEqual([
      ["gemini-3.8-flash", "retry", "skipped: quota cooldown"],
      ["gemini-3.5-flash-lite", "fallback", undefined],
    ]);
  });

  it("every model out of quota: AiBusyError at once, saying when to retry (at most an hour)", async () => {
    generateContent.mockRejectedValueOnce(quotaError("35237s")).mockRejectedValueOnce(quotaError("120s"));
    const { promise } = await run();
    await expect(promise).rejects.toMatchObject({ name: "AiBusyError", retryAfterSec: 120 });
    generateContent.mockClear();
    const again = await run();
    await expect(again.promise).rejects.toBeInstanceOf(AiBusyError);
    expect(generateContent).not.toHaveBeenCalled();
    // Once the fallback's cooldown ends it's used again (the main model is still out for hours).
    vi.advanceTimersByTime(121_000);
    generateContent.mockResolvedValueOnce(reply({ items: ["a", "b"] }));
    await expect((await run()).promise).resolves.toMatchObject({ model: "gemini-3.5-flash-lite" });
  });
});
