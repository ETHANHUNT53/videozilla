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

const nameField = z.string({ error: "Enter your name." }).trim().min(1, "Enter your name.").max(NAME_MAX, `Use at most ${NAME_MAX} characters for your name.`);

export const signUpSchema = z.object({
  name: nameField,
  email: emailField,
  password: newPasswordField,
});

/** Sign-in doesn't apply the new-password rules (older accounts keep their password); it only checks the shape. */
export const signInSchema = z.object({
  email: emailField,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX, "That password is too long."),
});

/** Changing the name later (Better Auth's `/update-user`): the same name rule as sign-up. */
const updateUserSchema = z.object({ name: nameField.optional() });
/** A new password set while signed in (`/change-password`): the same rules as sign-up. */
const changePasswordSchema = z.object({ newPassword: newPasswordField });

/** The Better Auth endpoints that take a name, an email or a new password, and their rules. */
const RULES: Record<string, z.ZodType<Record<string, unknown>>> = {
  "/sign-up/email": signUpSchema,
  "/sign-in/email": signInSchema,
  "/update-user": updateUserSchema,
  "/change-password": changePasswordSchema,
};

/** The first problem as one sentence for the form, or null when the input is fine. */
export function firstProblem(result: z.ZodSafeParseResult<unknown>): string | null {
  return result.success ? null : (result.error.issues[0]?.message ?? "Check the form and try again.");
}

/**
 * The server's check (a Better Auth `before` hook, server/auth.ts): for every endpoint that takes a name, an email or a
 * new password (sign-up, sign-in, name change, password change), the body with the checked values (email normalised,
 * name trimmed), or the first problem; null for every other auth path. (Changing the email is off in Better Auth.)
 */
export function checkAuthInput(path: string, body: unknown): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } | null {
  const schema = RULES[path];
  if (!schema) return null;
  const result = schema.safeParse(body);
  if (!result.success) return { ok: false, message: firstProblem(result) ?? "Check the form and try again." };
  return { ok: true, body: { ...(body as Record<string, unknown>), ...result.data } };
}
