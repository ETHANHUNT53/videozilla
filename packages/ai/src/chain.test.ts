import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { AiBlockedError, AiBusyError, budgetMs, generateJson, resetModelCooldowns, type AiCallLog } from "./generate-json";
import { aiChain } from "./providers";

/**
 * generateJson on AI_PROVIDER=chain (the default): Gemini → Groq → OpenRouter. Gemini through a mocked SDK, Groq and
 * OpenRouter through a mocked fetch, all with fake keys: no test ever reaches a real AI.
 */

const fetchMock = vi.fn<typeof fetch>();
const Shape = z.object({ items: z.array(z.string()).length(2) });
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (content: unknown) =>
  json(200, { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const good = () => ok({ items: ["a", "b"] });
const busy503 = () => json(503, { error: { message: "Service Unavailable" } });
const never = () => new Promise<never>(() => {});
const geminiReply = (data: unknown) => ({ text: JSON.stringify(data), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const geminiBusy = () => new Error("503 UNAVAILABLE: The model is overloaded due to high demand");
/** The real answer from the Gemini key today (2026-10-19), as the SDK throws it. */
const geminiDepleted = () =>
  Object.assign(
    new Error('{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}'),
    { status: 402 },
  );

/** Who was asked, in order: the Gemini SDK calls and the fetches share one timeline. */
const order: string[] = [];
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

async function run(deadlineMs?: number) {
  const logs: AiCallLog[] = [];
  const promise = generateJson({ system: "sys", prompt: "user prompt", schema: Shape, deadlineMs, onCall: (l) => void logs.push(l) });
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return { promise, logs };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("GEMINI_API_KEY", "gemini-test");
  vi.stubEnv("GEMINI_FAST_MODEL", "");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
  vi.stubEnv("GROQ_API_KEY", "groq-test");
  vi.stubEnv("GROQ_MODEL", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  delete process.env.OPENROUTER_MODEL;
  order.length = 0;
  generateContent.mockReset();
  fetchMock.mockReset();
  // Record the order of calls without changing what each mock answers.
  generateContent.mockImplementation(() => Promise.reject(new Error("unexpected Gemini call")));
  fetchMock.mockImplementation(() => Promise.reject(new Error("unexpected fetch")));
  resetModelCooldowns();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Gemini answers with these, in turn (then fails the test if called again). */
function gemini(...answers: (() => unknown)[]) {
  for (const a of answers)
    generateContent.mockImplementationOnce(() => {
      order.push("gemini");
      const r = a();
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    });
}
/** The fetches (Groq, OpenRouter) answer with these, in turn. */
function http(...answers: (() => Response | Promise<never>)[]) {
  for (const a of answers)
    fetchMock.mockImplementationOnce(async (url) => {
      order.push(String(url) === GROQ ? "groq" : "openrouter");
      return a();
    });
}

describe("AI_PROVIDER=chain (the default)", () => {
  it("is Gemini (GEMINI_FAST_MODEL) → Groq (GROQ_MODEL) → OpenRouter (OPENROUTER_MODEL)", () => {
    expect(aiChain().map((b) => [b.provider, b.model])).toEqual([
      ["gemini", "gemini-3.8-flash"],
      ["groq", "openai/gpt-oss-120b"],
      ["openrouter", "google/gemma-4-31b-it:free"],
    ]);
    vi.stubEnv("AI_PROVIDER", "Chain");
    vi.stubEnv("GEMINI_FAST_MODEL", "g-x");
    vi.stubEnv("GROQ_MODEL", "qwen/qwen3.8-27b");
    vi.stubEnv("OPENROUTER_MODEL", "x:free");
    expect(aiChain().map((b) => b.model)).toEqual(["g-x", "qwen/qwen3.8-27b", "x:free"]);
  });

  it("leaves out every tier whose key is missing (or OpenRouter turned off with an empty model)", () => {
    const providers = () => aiChain().map((b) => b.provider);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(providers()).toEqual(["groq", "openrouter"]);
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("GROQ_API_KEY", "");
    expect(providers()).toEqual(["gemini", "openrouter"]);
    vi.stubEnv("OPENROUTER_MODEL", "");
    expect(providers()).toEqual(["gemini"]);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => aiChain()).toThrow(/No AI key is set\. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY/);
  });

  it("Gemini answers first: no Groq or OpenRouter call, logged as 'ok' with provider 'gemini'", async () => {
    gemini(() => geminiReply({ items: ["a", "b"] }));
    const { promise, logs } = await run();
    await expect(promise).resolves.toEqual({ data: { items: ["a", "b"] }, model: "gemini-3.8-flash", provider: "gemini" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs).toEqual([{ provider: "gemini", model: "gemini-3.8-flash", status: "ok", latencyMs: expect.any(Number), inputTokens: 10, outputTokens: 5 }]);
  });

  it("no Gemini key: Groq answers first, and it's the 'ok' model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    http(good);
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ provider: "groq" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(logs.map((l) => [l.provider, l.status])).toEqual([["groq", "ok"]]);
  });

  it("no Groq key: Gemini busy → OpenRouter", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    gemini(geminiBusy, geminiBusy);
    http(good);
    await expect((await run()).promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(order).toEqual(["gemini", "gemini", "openrouter"]);
  });

  it("busy all the way: Gemini twice (one quick retry), then Groq, then OpenRouter answers", async () => {
    gemini(geminiBusy, geminiBusy);
    http(busy503, good);
    const { promise, logs } = await run();
    await expect(promise).resolves.toEqual({ data: { items: ["a", "b"] }, model: "google/gemma-4-31b-it:free", provider: "openrouter" });
    expect(order).toEqual(["gemini", "gemini", "groq", "openrouter"]);
    expect(urls()).toEqual([GROQ, OPENROUTER]);
    expect(logs.map((l) => [l.provider, l.model, l.status])).toEqual([
      ["gemini", "gemini-3.8-flash", "retry"],
      ["gemini", "gemini-3.8-flash", "retry"],
      ["groq", "openai/gpt-oss-120b", "retry"],
      ["openrouter", "google/gemma-4-31b-it:free", "fallback"],
    ]);
  });

  it("a rejected Gemini key or retired model doesn't break the chain: Groq answers, and Gemini is skipped for a while", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of [Object.assign(new Error("API key not valid. Please pass a valid API key."), { status: 400 }), Object.assign(new Error("models/gemini-9 is not found for API version v1beta"), { status: 404 })]) {
      resetModelCooldowns();
      error.mockClear();
      generateContent.mockReset().mockRejectedValueOnce(bad);
      fetchMock.mockReset().mockResolvedValueOnce(good());
      await expect((await run()).promise).resolves.toMatchObject({ provider: "groq" });
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/gemini rejected its key|gemini has no model/));
      // The next request skips Gemini at once (setup cooldown), logged as such.
      generateContent.mockClear();
      fetchMock.mockReset().mockResolvedValueOnce(good());
      const again = await run();
      await expect(again.promise).resolves.toMatchObject({ provider: "groq" });
      expect(generateContent).not.toHaveBeenCalled();
      expect(again.logs[0]).toMatchObject({ provider: "gemini", error: expect.stringMatching(/^skipped: setup cooldown/) });
    }
  });

  it("every tier needs a person (Gemini's key, Groq's model, OpenRouter's credits): 'unavailable' on the first request and the next", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    gemini(() => Object.assign(new Error("API key not valid."), { status: 400 }));
    http(
      () => json(404, { error: { message: "The model `openai/gpt-oss-120b` does not exist" } }),
      () => json(402, { error: { code: 402, message: "Insufficient credits" } }),
    );
    await expect((await run()).promise).rejects.toMatchObject({ name: "AiBusyError", unavailable: true });
    await expect((await run()).promise).rejects.toMatchObject({ name: "AiBusyError", unavailable: true });
    expect(order).toEqual(["gemini", "groq", "openrouter"]); // the second request called nobody
  });

  it("a bad request on every tier is that error (not 'busy'), thrown after the last tier", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockReset().mockRejectedValueOnce(Object.assign(new Error("400 INVALID_ARGUMENT: bad request"), { status: 400 }));
    fetchMock.mockReset().mockImplementation(async () => json(400, { error: { message: "bad request", type: "invalid_request_error" } }));
    const { promise } = await run();
    await expect(promise).rejects.toThrow(/openrouter 400: bad request/);
    expect(urls()).toEqual([GROQ, OPENROUTER]);
  });

  it("every tier busy: AiBusyError (the app answers 503 and gives the request back)", async () => {
    gemini(geminiBusy, geminiBusy);
    http(busy503, busy503);
    await expect((await run()).promise).rejects.toBeInstanceOf(AiBusyError);
    expect(order).toEqual(["gemini", "gemini", "groq", "openrouter"]);
  });

  it("the repair round stays on the tier that answered (Groq here), it doesn't go back to Gemini", async () => {
    gemini(geminiBusy, geminiBusy);
    http(() => ok({ items: ["only one"] }), good);
    await expect((await run()).promise).resolves.toMatchObject({ provider: "groq", data: { items: ["a", "b"] } });
    expect(order).toEqual(["gemini", "gemini", "groq", "groq"]);
  });

  it("a safety block on Gemini stops the chain: AiBlockedError, no Groq or OpenRouter call", async () => {
    gemini(() => ({ text: undefined, promptFeedback: { blockReason: "SAFETY" }, candidates: [] }));
    const { promise, logs } = await run();
    await expect(promise).rejects.toBeInstanceOf(AiBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs).toEqual([expect.objectContaining({ provider: "gemini", status: "failed", error: "blocked: prompt SAFETY" })]);
  });

  it("{\"refused\":true} from Groq is an ordinary reply: the schema decides (the refusal categories stay with the caller)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const Reply = z.union([z.object({ refused: z.literal(true), category: z.string() }), Shape]);
    http(() => ok({ refused: true, category: "violence" }));
    const promise = generateJson({ system: "s", prompt: "p", schema: Reply });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ provider: "groq", data: { refused: true, category: "violence" } });
  });
});

describe("billing / quota breaker across the chain", () => {
  it("Gemini out of prepaid credits (402): straight to Groq in the same request, and later requests skip Gemini at once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    gemini(geminiDepleted);
    http(good);
    const first = await run();
    await expect(first.promise).resolves.toMatchObject({ provider: "groq" });
    expect(order).toEqual(["gemini", "groq"]); // no second Gemini try
    expect(first.logs.map((l) => [l.provider, l.status])).toEqual([["gemini", "retry"], ["groq", "fallback"]]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/gemini says the account's prepaid credits are used up .*AI Studio.*30 min/));

    order.length = 0;
    http(good);
    const again = await run();
    await expect(again.promise).resolves.toMatchObject({ provider: "groq" });
    expect(order).toEqual(["groq"]); // Gemini isn't called at all
    expect(again.logs.map((l) => [l.provider, l.model, l.status, l.latencyMs, l.error?.split(" until")[0]])).toEqual([
      ["gemini", "gemini-3.8-flash", "retry", 0, "skipped: billing cooldown"],
      ["groq", "openai/gpt-oss-120b", "fallback", expect.any(Number), undefined],
    ]);
    // With Gemini out, Groq is the first model tried, so it gets the one quick busy retry.
    order.length = 0;
    http(busy503, good);
    await expect((await run()).promise).resolves.toMatchObject({ provider: "groq" });
    expect(order).toEqual(["groq", "groq"]);

    // After 30 min Gemini is tried again.
    vi.advanceTimersByTime(30 * 60_000 + 1);
    order.length = 0;
    gemini(() => geminiReply({ items: ["a", "b"] }));
    await expect((await run()).promise).resolves.toMatchObject({ provider: "gemini" });
    expect(order).toEqual(["gemini"]);
  });

  it("the Gemini SDK's 402 status alone is enough (whatever the message says)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    gemini(() => Object.assign(new Error("payment required"), { status: 402 }));
    http(good);
    await expect((await run()).promise).resolves.toMatchObject({ provider: "groq" });
    order.length = 0;
    http(good);
    await (await run()).promise;
    expect(order).toEqual(["groq"]);
  });

  it("Groq out of its daily quota (429) and Gemini out of credits: straight to OpenRouter, then all three out → AiBusyError at once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    gemini(geminiDepleted);
    http(() => json(429, { error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on requests per day (RPD): Limit 1000, Used 1000. Please try again in 2h13m5s.", code: "rate_limit_exceeded" } }), good);
    await expect((await run()).promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(order).toEqual(["gemini", "groq", "openrouter"]);

    order.length = 0;
    http(() => json(402, { error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }));
    const { promise, logs } = await run();
    // Gemini's 30 min is the soonest back.
    await expect(promise).rejects.toMatchObject({ name: "AiBusyError", retryAfterSec: 1800, unavailable: false }); // Groq is on a quota, not out of credits
    expect(order).toEqual(["openrouter"]);
    expect(logs.map((l) => [l.provider, l.error?.split(":")[0]])).toEqual([
      ["gemini", "skipped"],
      ["groq", "skipped"],
      ["openrouter", "openrouter 402"],
    ]);

    order.length = 0;
    await expect((await run()).promise).rejects.toBeInstanceOf(AiBusyError);
    expect(order).toEqual([]); // nothing is called while everything cools down
  });
});

describe("a longer deadline (25 s, notes) keeps every later tier's reserve", () => {
  it("budgetMs: all later reserves when that leaves this model its typical time, else the next one's, else everything", () => {
    const [gemini, groq, openrouter] = aiChain();
    expect(budgetMs(gemini, [groq, openrouter], 25_000)).toBe(15_000); // 25 − 4 − 6, Gemini's typical 9 s fits
    expect(budgetMs(gemini, [groq, openrouter], 15_000)).toBe(11_000); // 5 s would be too little: only Groq's 4 s
    expect(budgetMs(groq, [openrouter], 10_000)).toBe(4_000);
    expect(budgetMs(groq, [openrouter], 7_000)).toBe(7_000); // less than its own reserve otherwise: all of it
    expect(budgetMs(openrouter, [], 6_000)).toBe(6_000);
  });

  it("a few ms of overhead don't make Groq take OpenRouter's time (QA: Groq got 9.97 s and ran to the end)", () => {
    const [, groq, openrouter] = aiChain();
    expect(budgetMs(groq, [openrouter], 9_970)).toBe(3_970);
    expect(budgetMs(groq, [openrouter], 9_600)).toBe(3_600);
  });

  it("with real overhead between tiers (each ai_calls write takes 150 ms), OpenRouter still answers inside 25 s; the 15 s path still gives Groq its time", async () => {
    const slowLog = async () => {
      await new Promise((r) => setTimeout(r, 150));
    };
    for (const [deadline, expected] of [
      [25_000, ["gemini", "groq", "openrouter"]],
      [15_000, ["gemini", "groq"]],
    ] as const) {
      resetModelCooldowns();
      order.length = 0;
      gemini(never);
      http(never, good);
      const started = Date.now();
      const promise = generateJson({ system: "s", prompt: "p", schema: Shape, deadlineMs: deadline, onCall: slowLog });
      promise.catch(() => {});
      await vi.runAllTimersAsync();
      if (deadline === 25_000) await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
      else await expect(promise).rejects.toBeInstanceOf(AiBusyError);
      expect(order).toEqual(expected);
      expect(Date.now() - started).toBeLessThanOrEqual(deadline + 200); // the last log write may finish just after
      fetchMock.mockReset();
      generateContent.mockReset();
    }
  });

  it("a slow ai_calls write between tiers (700 ms, more than the slack) doesn't starve OpenRouter on the 25 s path", async () => {
    const slowLog = async () => {
      await new Promise((r) => setTimeout(r, 700));
    };
    gemini(never);
    http(never, good);
    const promise = generateJson({ system: "s", prompt: "p", schema: Shape, deadlineMs: 25_000, onCall: slowLog });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(order).toEqual(["gemini", "groq", "openrouter"]);
  });

  it("Gemini and Groq both never answer: 15 s, then 4 s, and OpenRouter still answers in its 6 s", async () => {
    gemini(never);
    http(never, good);
    const started = Date.now();
    const { promise, logs } = await run(25_000);
    await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(Date.now() - started).toBeLessThanOrEqual(25_000);
    expect(logs.map((l) => [l.provider, l.latencyMs])).toEqual([["gemini", 15_000], ["groq", 4_000], ["openrouter", expect.any(Number)]]);
  });

  it("a failed repair round on Gemini falls through to Groq, fresh", async () => {
    gemini(() => geminiReply({ items: ["one"] }), () => geminiReply({ items: ["still one"] }));
    http(good);
    await expect((await run(25_000)).promise).resolves.toMatchObject({ provider: "groq" });
    expect(order).toEqual(["gemini", "gemini", "groq"]);
  });
});

describe("the 15 s deadline across three tiers", () => {
  it("Gemini never answers: it gets 11 s (Groq's 4 s kept back), then Groq answers, all inside 15 s", async () => {
    gemini(never);
    http(good);
    const started = Date.now();
    const { promise, logs } = await run(15_000);
    await expect(promise).resolves.toMatchObject({ provider: "groq" });
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    expect(logs.map((l) => [l.provider, l.status, l.latencyMs])).toEqual([["gemini", "retry", 11_000], ["groq", "fallback", expect.any(Number)]]);
  });

  it("Gemini and Groq both never answer: Groq still gets its 4 s, then AiBusyError at 15 s (OpenRouter has no time left)", async () => {
    gemini(never);
    http(never);
    const started = Date.now();
    const { promise, logs } = await run(15_000);
    await expect(promise).rejects.toBeInstanceOf(AiBusyError);
    expect(Date.now() - started).toBe(15_000);
    expect(logs.map((l) => [l.provider, l.latencyMs])).toEqual([["gemini", 11_000], ["groq", 4_000]]);
    expect(urls()).toEqual([GROQ]);
  });

  it("Gemini fails fast, Groq never answers: Groq gets 9 s and OpenRouter its 6 s, inside 15 s", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    gemini(geminiDepleted);
    http(never, good);
    const started = Date.now();
    const { promise, logs } = await run(15_000);
    await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    expect(logs.map((l) => [l.provider, l.latencyMs])).toEqual([["gemini", expect.any(Number)], ["groq", 9_000], ["openrouter", expect.any(Number)]]);
  });

  it("Gemini busy twice (≈1 s retry pause), Groq slow: OpenRouter still gets its 6 s", async () => {
    gemini(geminiBusy, geminiBusy);
    http(never, good);
    const started = Date.now();
    const { promise, logs } = await run(15_000);
    await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    // 15 s − 1 s pause − 6 s for OpenRouter = 8 s for Groq.
    expect(logs.map((l) => [l.provider, l.latencyMs])).toEqual([["gemini", 0], ["gemini", 0], ["groq", 8_000], ["openrouter", expect.any(Number)]]);
  });
});

describe("AI_PROVIDER=mock is unchanged", () => {
  it("only sample data: with every key set, no Gemini call and no fetch", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    expect(aiChain().map((b) => b.provider)).toEqual(["mock"]);
    const logs: AiCallLog[] = [];
    const promise = generateJson({ system: "s", prompt: "p", schema: Shape, mock: () => ({ items: ["m", "n"] }), onCall: (l) => void logs.push(l) });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ data: { items: ["m", "n"] }, model: "mock", provider: "mock" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.map((l) => [l.provider, l.status])).toEqual([["mock", "ok"]]);
  });
});
