import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

/**
 * The boot check: a bad production AI config stops the server when it starts (exit code 1), not on the first user's
 * request, so a deploy with it fails visibly.
 */

afterEach(() => vi.unstubAllEnvs());

describe("instrumentation register()", () => {
  it("in production with a base-URL override: logs why and exits with code 1", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "http://localhost:9999");
    await register();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[boot\] GOOGLE_GEMINI_BASE_URL is for testing/));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps running without an override, in development, and on the edge runtime", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "http://localhost:9999");
    await register();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    await register();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "");
    vi.stubEnv("AI_PROVIDER", "chain");
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});
