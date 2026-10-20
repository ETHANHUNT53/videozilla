import { z } from "zod";

/**
 * Sign-up and sign-in rules (PRD F1, 2026-10-20: email + password with no email step), shared by the forms (instant
 * messages) and the server (a Better Auth hook in server/auth.ts checks every request against the same rules, so a
 * request that skips the page gets the same answer). Client-safe: no server imports.
 */

/** Longest password we accept: long passphrases are welcome, but there's no reason to hash megabytes. */
export const PASSWORD_MAX = 128;
export const PASSWORD_MIN = 8;
export const NAME_MAX = 60;

/** Trimmed and lowercased, so "Asha@Example.com " and "asha@example.com" are one account. */
export const emailField = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email({ error: "Enter a valid email address, like name@example.com." }));

/** At least 8 characters, at most 128; spaces are allowed inside (passphrases), but not only spaces. */
export const newPasswordField = z
  .string({ error: "Choose a password." })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)
  .refine((p) => p.trim().length >= PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters that aren't spaces.`);

export const signUpSchema = z.object({
  name: z.string({ error: "Enter your name." }).trim().min(1, "Enter your name.").max(NAME_MAX, `Use at most ${NAME_MAX} characters for your name.`),
  email: emailField,
  password: newPasswordField,
});

/** Sign-in doesn't apply the new-password rules (older accounts keep their password); it only checks the shape. */
export const signInSchema = z.object({
  email: emailField,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX, "That password is too long."),
});

/** The first problem as one sentence for the form, or null when the input is fine. */
export function firstProblem(result: z.ZodSafeParseResult<unknown>): string | null {
  return result.success ? null : (result.error.issues[0]?.message ?? "Check the form and try again.");
}

/**
 * The server's check (a Better Auth `before` hook, server/auth.ts): for the email sign-up and sign-in endpoints, the
 * body with the email normalised, or the first problem; null for every other auth path.
 */
export function checkAuthInput(path: string, body: unknown): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } | null {
  if (path !== "/sign-up/email" && path !== "/sign-in/email") return null;
  const result = (path === "/sign-up/email" ? signUpSchema : signInSchema).safeParse(body);
  if (!result.success) return { ok: false, message: firstProblem(result) ?? "Check the form and try again." };
  return { ok: true, body: { ...(body as Record<string, unknown>), ...result.data } };
}
