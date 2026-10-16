import { createAuthClient } from "better-auth/react";

/** Browser-side auth calls (sign in/up, Google, sign out, password reset). Same origin, so no baseURL needed. */
export const authClient = createAuthClient();
