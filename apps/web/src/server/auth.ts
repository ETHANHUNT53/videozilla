import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db, mongoClient } from "./db/mongo";
import { checkAuthInput, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth-schema";
import { env } from "./env";
import { requestAccountDataDeletion } from "./jobs/account-deletion";
import { getOrCreateProfile } from "./repos/profiles";

/**
 * Authentication (PRD F1, D12): email + password, Google sign-in, account linking. Users and sessions live in our own
 * MongoDB (collections: user, session, account, verification, rateLimit).
 *
 * No email is sent (your decision, 2026-10-20): signing up signs you in at once, nothing has to be verified, and there's
 * no "forgot password" until email comes back. The trade-off: an address isn't proven to belong to whoever typed it,
 * and a forgotten password needs a person (Google sign-in can't help: it isn't linked to a password account). Passwords are hashed by Better Auth (scrypt) and never
 * logged.
 */
export const auth = betterAuth({
  appName: "Videozilla",
  baseURL: env.appUrl,
  // Transactions need a replica set: Atlas and the local dev database (npm run db) both are one.
  database: mongodbAdapter(db(), { client: mongoClient() }),
  emailAndPassword: {
    enabled: true,
    // Accounts made before this change (some never verified) sign in the same way.
    requireEmailVerification: false,
    autoSignIn: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
  },
  // The email flows are off: nothing would send their links. (Better Auth also refuses a reset with no sender.)
  disabledPaths: ["/request-password-reset", "/reset-password", "/reset-password/:token", "/send-verification-email", "/verify-email"],
  // Every request is checked against the same Zod rules as the forms (lib/auth-schema.ts), so one that skips the page
  // gets the same answer; the email is stored trimmed and lowercased.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const checked = checkAuthInput(ctx.path, ctx.body);
      if (!checked) return;
      if (!checked.ok) throw new APIError("BAD_REQUEST", { message: checked.message });
      return { context: { ...ctx, body: checked.body } };
    }),
  },
  // Limits guessing and mass sign-ups (per IP, per minute), kept in MongoDB so every server instance shares them. On in
  // development too, so the limit is visible before launch.
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  socialProviders: env.google.configured
    ? { google: { clientId: env.google.clientId, clientSecret: env.google.clientSecret, prompt: "select_account" } }
    : {},
  account: {
    // No automatic linking of Google into an existing account: without email verification, anyone could sign up with a
    // password at someone else's address and wait for its owner's Google sign-in to be merged into their account. A
    // Google sign-in for an email that already has a password account fails instead (the sign-in page says to use the
    // password). Accounts linked before this change stay linked.
    accountLinking: { enabled: true, disableImplicitLinking: true, requireLocalEmailVerified: true, trustedProviders: [] },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    // No cookie cache: every session check reads the database, so a revoked session (sign-out elsewhere, password
    // reset, deleted account) stops working at once, on the server and in /api/auth/get-session alike.
    cookieCache: { enabled: false },
  },
  user: {
    // Account deletion (DB Design §6.12): only once Better Auth has removed the sign-in records are the user's queued
    // work cancelled and their data deleted (a background job), so a deletion that fails changes nothing.
    deleteUser: {
      enabled: true,
      afterDelete: async (user) => {
        await requestAccountDataDeletion(user.id);
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await getOrCreateProfile(user.id, user.name ?? "");
        },
      },
    },
  },
  // nextCookies must stay last: it lets server actions set the session cookie.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

/** The session for these request headers, checked against the database. Pages (dal.ts) and the API (api/session.ts) both use it. */
export function readSession(headers: Headers) {
  return auth.api.getSession({ headers });
}
