import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { db, mongoClient } from "./db/mongo";
import { actionEmail, sendEmail } from "./email";
import { env } from "./env";
import { requestAccountDataDeletion } from "./jobs/account-deletion";
import { getOrCreateProfile } from "./repos/profiles";

/**
 * Authentication (PRD F1, D12): email + password with verification, Google sign-in, account linking.
 * Users and sessions live in our own MongoDB (collections: user, session, account, verification).
 */
export const auth = betterAuth({
  appName: "Videozilla",
  baseURL: env.appUrl,
  // Transactions need a replica set: Atlas and the local dev database (npm run db) both are one.
  database: mongodbAdapter(db(), { client: mongoClient() }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const mail = actionEmail("Reset your password", "Tap the button to choose a new password. The link expires in an hour.", "Reset password", url);
      await sendEmail({ to: user.email, subject: "Reset your Videozilla password", ...mail });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      const mail = actionEmail("Verify your email", `Welcome to Videozilla, ${user.name || "creator"}! Confirm your email to start making videos.`, "Verify email", url);
      await sendEmail({ to: user.email, subject: "Verify your Videozilla email", ...mail });
    },
  },
  socialProviders: env.google.configured
    ? { google: { clientId: env.google.clientId, clientSecret: env.google.clientSecret, prompt: "select_account" } }
    : {},
  account: {
    // Google + password on the same verified email become one account (PRD F1 edge case).
    accountLinking: { enabled: true, trustedProviders: ["google", "email-password"] },
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
