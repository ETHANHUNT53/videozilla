import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

/** The boot check: a bad production AI config fails when the server starts, not on the first user's request. */

afterEach(() => vi.unstubAllEnvs());

describe("instrumentation register()", () => {
  it("throws at boot in production with a base-URL override; fine without one, in development, and on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "http://localhost:9999");
    await expect(register()).rejects.toThrow(/GOOGLE_GEMINI_BASE_URL is for testing/);
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await expect(register()).resolves.toBeUndefined();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    await expect(register()).resolves.toBeUndefined();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "");
    vi.stubEnv("AI_PROVIDER", "chain");
    await expect(register()).resolves.toBeUndefined();
  });
});
