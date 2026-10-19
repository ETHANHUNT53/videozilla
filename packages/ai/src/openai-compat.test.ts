import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiBlockedError, AiBusyError, AiOutputError, generateJson, resetModelCooldowns, type AiCallLog } from "./generate-json";
import { rateLimitCooldownMs } from "./openai-compat";
import { aiChain } from "./providers";

/** generateJson on AI_PROVIDER=groq: Groq main, OpenRouter backup, both through a mocked fetch (fake keys only). */

const fetchMock = vi.fn<typeof fetch>();
const Shape = z.object({ items: z.array(z.string()).length(2) });
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (content: unknown, usage = { prompt_tokens: 10, completion_tokens: 5 }) =>
  json(200, { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }], usage });
const good = () => ok({ items: ["a", "b"] });
const groqBusy = () => json(503, { error: { message: "Service Unavailable", type: "internal_server_error" } });
/** Groq's per-minute token limit (shape from console.groq.com/docs/rate-limits). */
const groqTpm = () =>
  json(429, { error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 900. Please try again in 6.5s.", type: "tokens", code: "rate_limit_exceeded" } }, { "retry-after": "7" });
const groqDaily = () =>
  json(429, { error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 2h13m5s.", type: "requests", code: "rate_limit_exceeded" } });

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> }));

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
  vi.stubEnv("AI_PROVIDER", "groq");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "groq-test");
  vi.stubEnv("GROQ_MODEL", "");
  vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  delete process.env.OPENROUTER_MODEL;
  fetchMock.mockReset();
  resetModelCooldowns();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AI_PROVIDER", () => {
  it("groq: Groq (gpt-oss-120b) with the OpenRouter free backup (gemma-4-31b-it:free), never Gemini", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    expect(aiChain().map((b) => [b.provider, b.model])).toEqual([
      ["groq", "openai/gpt-oss-120b"],
      ["openrouter", "google/gemma-4-31b-it:free"],
    ]);
  });

  it("gemini selects the Gemini models; an unknown value is a clear error, never a silent fallback", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("GEMINI_FAST_MODEL", "");
    vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
    expect(aiChain()[0]).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash" });
    vi.stubEnv("AI_PROVIDER", "openai");
    expect(() => aiChain()).toThrow(/AI_PROVIDER must be chain, groq, gemini or mock/);
  });

  it("model names come from GROQ_MODEL / OPENROUTER_MODEL; an empty OPENROUTER_MODEL or no key turns the backup off", () => {
    vi.stubEnv("GROQ_MODEL", "qwen/qwen3.8-27b");
    vi.stubEnv("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free");
    expect(aiChain().map((b) => b.model)).toEqual(["qwen/qwen3.8-27b", "nvidia/nemotron-3-super-120b-a12b:free"]);
    vi.stubEnv("OPENROUTER_MODEL", "");
    expect(aiChain().map((b) => b.provider)).toEqual(["groq"]);
    vi.stubEnv("OPENROUTER_MODEL", "x:free");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(aiChain().map((b) => b.provider)).toEqual(["groq"]);
  });

  it("needs GROQ_API_KEY", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(generateJson({ system: "s", prompt: "p", schema: Shape })).rejects.toThrow(/GROQ_API_KEY is missing/);
  });
});

describe("Groq main model", () => {
  it("sends the system prompt, JSON mode and low reasoning, and logs the call with provider 'groq'", async () => {
    fetchMock.mockResolvedValueOnce(good());
    const { promise, logs } = await run();
    await expect(promise).resolves.toEqual({ data: { items: ["a", "b"] }, model: "openai/gpt-oss-120b", provider: "groq" });
    const [req] = calls();
    expect(req.url).toBe(GROQ);
    expect(req.headers.authorization).toBe("Bearer groq-test");
    expect(req.body).toMatchObject({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "user prompt" }],
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 4096,
    });
    expect(logs).toEqual([{ provider: "groq", model: "openai/gpt-oss-120b", status: "ok", latencyMs: expect.any(Number), inputTokens: 10, outputTokens: 5 }]);
  });

  it("Qwen 3.8 gets reasoning turned off", async () => {
    vi.stubEnv("GROQ_MODEL", "qwen/qwen3.8-27b");
    fetchMock.mockResolvedValueOnce(good());
    await (await run()).promise;
    expect(calls()[0].body).toMatchObject({ model: "qwen/qwen3.8-27b", reasoning_effort: "none" });
    expect(calls()[0].body.include_reasoning).toBeUndefined();
  });

  it("repairs a wrong shape: the errors go back as a user turn after the model's reply", async () => {
    fetchMock.mockResolvedValueOnce(ok({ items: ["only one"] })).mockResolvedValueOnce(good());
    const { promise } = await run();
    await expect(promise).resolves.toMatchObject({ data: { items: ["a", "b"] }, provider: "groq" });
    const messages = calls()[1].body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[3].content).toMatch(/did not match the required shape: items/);
  });

  it("Groq's 400 'failed to generate JSON' goes to the repair round with the text it generated", async () => {
    fetchMock
      .mockResolvedValueOnce(json(400, { error: { message: "Failed to generate JSON. Please adjust your prompt.", type: "invalid_request_error", code: "json_validate_failed", failed_generation: "{items: [a" } }))
      .mockResolvedValueOnce(good());
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ data: { items: ["a", "b"] } });
    const messages = calls()[1].body.messages as { role: string; content: string }[];
    expect(messages[2]).toEqual({ role: "assistant", content: "{items: [a" });
    expect(messages[3].content).toMatch(/not valid JSON/);
    expect(logs[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/^groq 400: Failed to generate JSON/) });
  });

  it("invalid JSON twice: AiOutputError", async () => {
    fetchMock.mockImplementation(async () => ok("not json"));
    await expect((await run()).promise).rejects.toBeInstanceOf(AiOutputError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a bad key (401) with no later tier fails at once, naming the setting to check", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", ""); // Groq alone: nothing to move on to
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(json(401, { error: { message: "Invalid API Key", type: "invalid_request_error" } }));
    await expect((await run()).promise).rejects.toThrow(/groq 401: Invalid API Key \(check GROQ_API_KEY/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a request too large for Groq's whole per-minute limit (413) goes to OpenRouter, and Groq stays available for smaller ones", async () => {
    fetchMock
      .mockResolvedValueOnce(json(413, { error: { message: "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9500, please reduce your message size and try again.", type: "tokens" } }))
      .mockResolvedValueOnce(ok({ items: ["a", "b"] }));
    await expect((await run()).promise).resolves.toMatchObject({ provider: "openrouter" });
    // No retry of Groq for that request.
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual(["https://api.groq.com/openai/v1/chat/completions", "https://openrouter.ai/api/v1/chat/completions"]);
    // No cooldown: the next (small) request goes to Groq first again.
    fetchMock.mockReset().mockResolvedValueOnce(ok({ items: ["a", "b"] }));
    await expect((await run()).promise).resolves.toMatchObject({ provider: "groq" });
  });

  it("a request too large for Groq with no later tier: AiBusyError (the app answers 503 and refunds), not a crash", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    fetchMock.mockResolvedValueOnce(json(413, { error: { message: "Request too large for model x on tokens per minute (TPM): Limit 8000, Requested 9500" } }));
    await expect((await run()).promise).rejects.toMatchObject({ name: "AiBusyError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("{\"refused\":true} is an ordinary reply here (Groq has no block reasons): the schema decides", async () => {
    const Reply = z.union([z.object({ refused: z.literal(true) }), Shape]);
    fetchMock.mockResolvedValueOnce(ok({ refused: true }));
    const promise = generateJson({ system: "s", prompt: "p", schema: Reply });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ data: { refused: true } });
  });
});

describe("OpenRouter backup", () => {
  it("busy Groq: retried once, then OpenRouter answers, logged as fallback with provider 'openrouter'", async () => {
    fetchMock.mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(good());
    const { promise, logs } = await run();
    await expect(promise).resolves.toEqual({ data: { items: ["a", "b"] }, model: "google/gemma-4-31b-it:free", provider: "openrouter" });
    expect(calls().map((c) => c.url)).toEqual([GROQ, GROQ, OPENROUTER]);
    const backup = calls()[2];
    expect(backup.headers).toMatchObject({ authorization: "Bearer or-test", "X-OpenRouter-Title": "Videozilla" });
    expect(backup.body).toMatchObject({ model: "google/gemma-4-31b-it:free", response_format: { type: "json_object" }, max_tokens: 4096, provider: { require_parameters: true } });
    expect(backup.body.reasoning_effort).toBeUndefined();
    expect(logs.map((l) => [l.provider, l.status])).toEqual([["groq", "retry"], ["groq", "retry"], ["openrouter", "fallback"]]);
  });

  it("no OpenRouter key: Groq gets both tries, then AiBusyError", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    fetchMock.mockImplementation(async () => groqBusy());
    await expect((await run()).promise).rejects.toBeInstanceOf(AiBusyError);
    expect(calls().map((c) => c.url)).toEqual([GROQ, GROQ]);
  });

  it("a 200 that carries only an error (OpenRouter's mid-request failure) is treated as that error", async () => {
    fetchMock.mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(json(200, { error: { code: 502, message: "Provider returned error" } }));
    const { promise, logs } = await run();
    await expect(promise).rejects.toBeInstanceOf(AiBusyError);
    expect(logs.at(-1)).toMatchObject({ provider: "openrouter", status: "retry", error: "openrouter 502: Provider returned error" });
  });

  it("402 (no credits) puts the backup in a 30-min billing cooldown, with a loud server-log line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(json(402, { error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }));
    await expect((await run()).promise).rejects.toBeInstanceOf(AiBusyError);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/openrouter says .* credits .*openrouter\.ai.*30 min/));
    fetchMock.mockReset().mockImplementation(async () => groqBusy());
    const { logs } = await run();
    expect(calls().map((c) => c.url)).toEqual([GROQ, GROQ]); // the backup is skipped
    expect(logs.at(-1)).toMatchObject({ provider: "openrouter", error: expect.stringMatching(/^skipped: billing cooldown/) });
  });

  it("OpenRouter's moderation (403 content_policy_violation) is a block: AiBlockedError at once", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq-test");
    fetchMock.mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(json(403, { error: { code: 403, message: "Input was flagged", metadata: { error_type: "content_policy_violation" } } }));
    const { promise, logs } = await run();
    await expect(promise).rejects.toBeInstanceOf(AiBlockedError);
    expect(logs.at(-1)).toMatchObject({ provider: "openrouter", status: "failed", error: "blocked: openrouter moderation" });
  });
});

describe("rate limits → quota circuit breaker", () => {
  it("cooldown from retry-after, OpenRouter's X-RateLimit-Reset, or Groq's 'try again in'; daily caps without one wait 30 min", () => {
    const h = (o: Record<string, string> = {}) => new Headers(o);
    expect(rateLimitCooldownMs(h({ "retry-after": "42" }), "")).toBe(42_000);
    expect(rateLimitCooldownMs(h({ "retry-after": "2" }), "")).toBe(10_000); // at least 10 s
    expect(rateLimitCooldownMs(h({ "x-ratelimit-reset": String(Date.now() + 600_000) }), "")).toBe(600_000);
    expect(rateLimitCooldownMs(h(), "Please try again in 2m59.5s.")).toBe(179_500);
    expect(rateLimitCooldownMs(h(), "Rate limit exceeded: free-models-per-day")).toBe(30 * 60_000);
    expect(rateLimitCooldownMs(h(), "Rate limit exceeded")).toBe(60_000);
  });

  it("Groq's per-minute limit: no second Groq try, straight to the backup, and Groq is skipped until the cooldown ends", async () => {
    fetchMock.mockResolvedValueOnce(groqTpm()).mockImplementation(async () => good());
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(calls().map((c) => c.url)).toEqual([GROQ, OPENROUTER]);
    expect(logs[0]).toMatchObject({ provider: "groq", status: "retry", error: expect.stringMatching(/tokens per minute/) });

    fetchMock.mockClear();
    await (await run()).promise;
    expect(calls().map((c) => c.url)).toEqual([OPENROUTER]); // still cooling down (10 s)
    vi.advanceTimersByTime(11_000);
    fetchMock.mockClear();
    await (await run()).promise;
    expect(calls().map((c) => c.url)).toEqual([GROQ]); // back
  });

  it("both out of their daily quota: AiBusyError at once, saying when the first is back (at most an hour)", async () => {
    fetchMock
      .mockResolvedValueOnce(groqDaily())
      .mockResolvedValueOnce(json(429, { error: { code: 429, message: "Rate limit exceeded: free-models-per-day", metadata: { error_type: "rate_limit_exceeded" } } }, { "x-ratelimit-reset": String(Date.now() + 1_200_000) }));
    await expect((await run()).promise).rejects.toMatchObject({ name: "AiBusyError", retryAfterSec: 1200 });
    fetchMock.mockClear();
    await expect((await run()).promise).rejects.toBeInstanceOf(AiBusyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a host behind OpenRouter rate-limiting us is just busy (no cooldown on our side)", async () => {
    fetchMock.mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(json(429, { error: { code: 429, message: "temporarily rate-limited upstream", metadata: { provider_name: "Google AI Studio", raw: "429" } } }));
    await expect((await run()).promise).rejects.toBeInstanceOf(AiBusyError);
    fetchMock.mockReset().mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(groqBusy()).mockResolvedValueOnce(good());
    await expect((await run()).promise).resolves.toMatchObject({ provider: "openrouter" });
  });
});

describe("deadline", () => {
  it("a Groq call that never answers leaves OpenRouter its 6 s reserve, inside the deadline", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(good());
    const started = Date.now();
    const { promise, logs } = await run(15_000);
    await expect(promise).resolves.toMatchObject({ provider: "openrouter" });
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    expect(logs.map((l) => [l.provider, l.status, l.latencyMs])).toEqual([["groq", "retry", 9_000], ["openrouter", "fallback", expect.any(Number)]]);
  });

  it("a network error is busy (retried), not a crash", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(good());
    const { promise, logs } = await run();
    await expect(promise).resolves.toMatchObject({ provider: "groq" });
    expect(logs[0]).toMatchObject({ status: "retry", error: "groq: network error: fetch failed" });
  });
});
