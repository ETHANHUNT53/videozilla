import "server-only";
import { truncateChars } from "@videozilla/db";
import { ObjectId } from "mongodb";
import { ABOUT_MAX_CHARS } from "@/lib/profile-limits";
import { collections, ensureMigrated } from "../db/mongo";
import type { Audience, Language, ProfileDoc, VoiceGender } from "../db/types";

/** India-first defaults (PRD §5.1, DB Design §4.2). */
export const DEFAULT_PROFILE = {
  defaultLanguage: "en" as Language,
  defaultLengthPreset: 60 as const,
  defaultVoiceGender: "female" as VoiceGender,
  defaultStyleId: "midnight",
  defaultAudience: "students" as Audience,
  timezone: "Asia/Kolkata",
  emailNotifications: true,
};

/** Every field of a brand-new profile (DB Design §4.2). */
function newProfileFields(userId: string, displayName: string, now: Date): ProfileDoc {
  return {
    _id: new ObjectId(),
    userId,
    // The database allows 60 characters; a longer Google name must not make sign-up fail.
    displayName: truncateChars(displayName.trim(), 60),
    ...DEFAULT_PROFILE,
    role: "user",
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns the user's profile, creating it with defaults on first use. */
export async function getOrCreateProfile(userId: string, displayName = ""): Promise<ProfileDoc> {
  await ensureMigrated();
  const res = await collections.profiles().findOneAndUpdate(
    { userId },
    { $setOnInsert: newProfileFields(userId, displayName, new Date()) },
    { upsert: true, returnDocument: "after" },
  );
  return res!;
}

/** What a user can change on their profile (API Design §13.1 `PATCH /me/profile`). Never `role` or internal fields. */
export type ProfileUpdate = Partial<
  Pick<
    ProfileDoc,
    "displayName" | "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultAudience" | "defaultBoardOrExam" | "timezone" | "emailNotifications" | "about"
  >
> & {
  /** Onboarding finished or skipped (F1.12): records when. Only `true` — it can't be undone. */
  onboardingCompleted?: true;
};

// Longest "what do you teach or create about" answer, in characters (shared with the forms).
export { ABOUT_MAX_CHARS };

// An IANA zone name as written in the tz database: "UTC" or Area/Location with capitalised parts ("Asia/Kolkata",
// "America/Argentina/Buenos_Aires"). Offsets ("+05:30"), other casings ("utc") and Etc/ zones are not accepted.
const IANA_NAME = /^(?:UTC|[A-Z][a-z][A-Za-z]*(?:\/[A-Z][a-z][A-Za-z0-9_+-]*)+)$/;

/**
 * True for an IANA time zone name the runtime knows, in its canonical spelling (e.g. "Asia/Kolkata"). Later features
 * schedule posts by it, so it must be a real zone with its daylight-saving rules, never a fixed offset or an alias in
 * another casing. (Intl alone also accepts "+05:30" and "utc".) The name is stored exactly as checked.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!IANA_NAME.test(tz) || tz.startsWith("Etc/")) return false;
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates the user's profile defaults and returns the result, in one upsert: if the profile doesn't exist yet it is
 * created with the defaults plus these changes, so a save can never be lost. Last write wins (profiles have no
 * revision; API Design §8 lists only projects, ideas and posts as concurrently edited).
 */
export async function updateProfile(userId: string, update: ProfileUpdate, displayNameFallback = ""): Promise<ProfileDoc> {
  await ensureMigrated();
  const now = new Date();
  const { onboardingCompleted, ...fields } = update;
  const set: Record<string, unknown> = { ...fields, updatedAt: now };
  if (fields.displayName !== undefined) set.displayName = truncateChars(fields.displayName.trim(), 60);
  if (fields.about !== undefined) set.about = truncateChars(fields.about?.trim() ?? "", ABOUT_MAX_CHARS) || null;
  // Defaults only for a new profile, and never for a field this update sets (MongoDB refuses both on one path).
  const onInsert = Object.fromEntries(Object.entries(newProfileFields(userId, displayNameFallback, now)).filter(([k]) => !(k in set)));
  const res = await collections.profiles().findOneAndUpdate({ userId }, { $set: set, $setOnInsert: onInsert }, { upsert: true, returnDocument: "after" });
  // Onboarding done: record when only the first time, so a repeated request (double-click, retry) keeps the real time.
  if (onboardingCompleted && !res!.onboardingCompletedAt) {
    const done = await collections.profiles().findOneAndUpdate({ userId, onboardingCompletedAt: null }, { $set: { onboardingCompletedAt: now } }, { returnDocument: "after" });
    return done ?? (await collections.profiles().findOne({ userId }))!;
  }
  return res!;
}
