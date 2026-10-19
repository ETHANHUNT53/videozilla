import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAiConfigSafe, BASE_URL_SETTINGS } from "./config";
import { aiChain } from "./providers";

/** Test-only AI settings are refused in production (QA: the Gemini key went to a fake localhost URL). Fake keys only. */

afterEach(() => vi.unstubAllEnvs());

describe("assertAiConfigSafe", () => {
  it.each(BASE_URL_SETTINGS)("%s in production is refused, naming the setting", (name) => {
    expect(() => assertAiConfigSafe({ NODE_ENV: "production", [name]: "http://localhost:9999" })).toThrow(new RegExp(`${name} is for testing against fake servers only`));
  });

  it("mock in production is refused; empty overrides, and anything outside production, are fine", () => {
    expect(() => assertAiConfigSafe({ NODE_ENV: "production", AI_PROVIDER: "Mock" })).toThrow(/development only/);
    expect(() => assertAiConfigSafe({ NODE_ENV: "production", GROQ_BASE_URL: "  ", AI_PROVIDER: "chain" })).not.toThrow();
    expect(() => assertAiConfigSafe({ NODE_ENV: "development", GOOGLE_GEMINI_BASE_URL: "http://localhost:9999", AI_PROVIDER: "mock" })).not.toThrow();
    expect(() => assertAiConfigSafe({ NODE_ENV: "test", OPENROUTER_BASE_URL: "http://localhost:9999" })).not.toThrow();
  });
});

describe("aiChain refuses GOOGLE_GEMINI_BASE_URL in production before any key is used", () => {
  it.each(["chain", "gemini"])("AI_PROVIDER=%s", (provider) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", provider);
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "http://localhost:9999");
    expect(() => aiChain()).toThrow(/GOOGLE_GEMINI_BASE_URL is for testing against fake servers only/);
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "");
    expect(aiChain()[0]).toMatchObject({ provider: "gemini" });
  });
});
