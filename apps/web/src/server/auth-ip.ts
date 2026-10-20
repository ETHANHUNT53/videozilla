/**
 * Which request header says who the client is, for Better Auth's rate limits (sign-in 10, sign-up 5 per minute per
 * IP). A header the client can set itself (`X-Forwarded-For` sent straight to the app) would let anyone dodge the
 * limit by sending a new address each time, so only a header our host sets is trusted:
 * - `AUTH_IP_HEADERS` (comma-separated, e.g. `x-real-ip` or `cf-connecting-ip`): the header your proxy sets, when
 *   the app is only reachable through it. With `AUTH_TRUSTED_PROXIES` (IPs or CIDRs of your proxies) a forwarded
 *   chain is read from the right, skipping those hops;
 * - on Vercel (`VERCEL=1`) without a setting: `x-real-ip`, which Vercel sets to the client's address (a client
 *   can't override it);
 * - anywhere else without a setting: no header is trusted. Better Auth then keys every request alike (one shared
 *   limit; `127.0.0.1` in development), which can't be dodged but limits everyone together, so set
 *   `AUTH_IP_HEADERS` behind a real proxy.
 * See docs/setup/DEPLOY_NOTES.md.
 */
export function authIpOptions(env: Record<string, string | undefined> = process.env): { ipAddressHeaders: string[]; trustedProxies?: string[] } {
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const configured = list(env.AUTH_IP_HEADERS);
  const proxies = list(env.AUTH_TRUSTED_PROXIES);
  const headers = configured.length ? configured : env.VERCEL === "1" ? ["x-real-ip"] : [];
  return proxies.length ? { ipAddressHeaders: headers, trustedProxies: proxies } : { ipAddressHeaders: headers };
}
