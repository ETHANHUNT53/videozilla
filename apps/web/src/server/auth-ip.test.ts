import { describe, expect, it } from "vitest";
import { authIpOptions } from "./auth-ip";

/** Whose address a sign-in / sign-up rate limit counts: never a header a client can fake (QA, 2026-10-20). */

describe("authIpOptions", () => {
  it("off Vercel with no setting: no header is trusted (one shared limit, can't be dodged with a fake X-Forwarded-For)", () => {
    expect(authIpOptions({})).toEqual({ ipAddressHeaders: [] });
    expect(authIpOptions({ NODE_ENV: "production" }).ipAddressHeaders).not.toContain("x-forwarded-for");
  });

  it("on Vercel: x-real-ip, which Vercel sets itself", () => {
    expect(authIpOptions({ VERCEL: "1" })).toEqual({ ipAddressHeaders: ["x-real-ip"] });
  });

  it("AUTH_IP_HEADERS and AUTH_TRUSTED_PROXIES win, trimmed and lowercased", () => {
    expect(authIpOptions({ VERCEL: "1", AUTH_IP_HEADERS: " CF-Connecting-IP , x-real-ip" })).toEqual({ ipAddressHeaders: ["cf-connecting-ip", "x-real-ip"] });
    expect(authIpOptions({ AUTH_IP_HEADERS: "x-forwarded-for", AUTH_TRUSTED_PROXIES: "10.0.0.0/24, 192.0.2.10" })).toEqual({
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["10.0.0.0/24", "192.0.2.10"],
    });
  });
});
