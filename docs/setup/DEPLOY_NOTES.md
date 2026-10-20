# Deploy notes

Settings that matter when the web app runs somewhere other than `npm run dev`. Collected here as they come up; the full staging and production checklist is F10.4.

## Sign-in rate limits: which IP header to trust

Sign-in is limited to 10 tries and sign-up to 5 per minute **per client IP** (Better Auth's limiter, stored in MongoDB; PRD D16). The app learns the client's IP from a request header, and a header the client can set itself (for example `X-Forwarded-For` sent straight to the app) would let anyone dodge the limit by sending a new address each time. So only a header that **your host or proxy sets** is trusted (`apps/web/src/server/auth-ip.ts`):

| Where the app runs | What to set | What happens |
|---|---|---|
| **Vercel** | nothing | `x-real-ip`, which Vercel sets to the client's address (a client can't override it) |
| Behind your own proxy or CDN (Cloudflare, nginx, a load balancer) **and only reachable through it** | `AUTH_IP_HEADERS` = the header that proxy sets, e.g. `cf-connecting-ip` or `x-real-ip` | per-client limits from that header |
| Behind a chain of proxies that append to `X-Forwarded-For` | `AUTH_IP_HEADERS=x-forwarded-for` and `AUTH_TRUSTED_PROXIES` = the IPs or CIDR ranges of **your** proxies (comma-separated, e.g. `10.0.0.0/24`) | the chain is read from the right, skipping your proxies; the first other address is the client |
| Anywhere else, with no setting (including `npm run dev`) | — | no header is trusted: every request counts against **one shared limit** (`127.0.0.1` in development). It can't be dodged, but all users share 10 sign-ins and 5 sign-ups a minute, and the server logs a warning |

Don't set `AUTH_IP_HEADERS` to a header your proxy doesn't overwrite, and don't list a broad private range in `AUTH_TRUSTED_PROXIES` that also covers clients.

In development everyone shares that one limit, so testing many sign-ups in a row can hit "Too many attempts. Wait a minute and try again." Wait a minute, or clear the `rateLimit` collection in the local database (the counts live there, so restarting `npm run dev` doesn't reset them).
