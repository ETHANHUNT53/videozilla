import { AUDIENCES, BOARDS_OR_EXAMS } from "@videozilla/db";
import { z } from "zod";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { toProfile } from "@/server/api/resources";
import { ABOUT_MAX_CHARS, isValidTimeZone, updateProfile } from "@/server/repos/profiles";

/**
 * `PATCH /api/v1/me/profile` (API Design §13.1): change the defaults new videos start with, the display name, time
 * zone, email notifications and "what do you teach or create about", or mark onboarding done (F1.12). Any subset of
 * the fields; the response is the whole `Profile`. Strict: `role` and other internal fields can't be sent.
 * (`GET /api/v1/me` returns the profile.)
 */
const body = z
  .strictObject({
    // May be empty; counted in characters (code points) like the database's 60-character limit.
    displayName: z.string().refine((s) => Array.from(s).length <= 60, "Must be at most 60 characters").optional(),
    defaultLanguage: z.enum(["en", "hi"]).optional(),
    defaultLengthPreset: z.union([z.literal(60), z.literal(90)]).optional(),
    defaultVoiceGender: z.enum(["female", "male"]).optional(),
    defaultAudience: z.enum(AUDIENCES).optional(),
    defaultBoardOrExam: z.enum(BOARDS_OR_EXAMS).nullable().optional(),
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Must be a time zone name like Asia/Kolkata").optional(),
    emailNotifications: z.boolean().optional(),
    // "What do you teach or create about?" — optional; empty or null clears it.
    about: z
      .string()
      .refine((s) => Array.from(s).length <= ABOUT_MAX_CHARS, `Must be at most ${ABOUT_MAX_CHARS} characters`)
      .nullable()
      .optional(),
    // Onboarding finished or skipped (F1.12). Only true: it can't be undone.
    onboardingCompleted: z.literal(true).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Send at least one field to change");

export const PATCH = apiRoute({ body }, async ({ user, body }) => toProfile(await updateProfile(user.id, body, user.name)));

const notAllowed = methodNotAllowed(["PATCH"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as POST, notAllowed as PUT };
