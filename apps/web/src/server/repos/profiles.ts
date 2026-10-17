import "server-only";
import { truncateChars } from "@videozilla/db";
import { ObjectId } from "mongodb";
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

/** Returns the user's profile, creating it with defaults on first use. */
export async function getOrCreateProfile(userId: string, displayName = ""): Promise<ProfileDoc> {
  await ensureMigrated();
  const now = new Date();
  const res = await collections.profiles().findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        userId,
        // The database allows 60 characters; a longer Google name must not make sign-up fail.
        displayName: truncateChars(displayName.trim(), 60),
        ...DEFAULT_PROFILE,
        role: "user",
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return res!;
}

/** What a user can change on their profile (API Design §13.1 `PATCH /me/profile`). Never `role` or internal fields. */
export type ProfileUpdate = Partial<
  Pick<
    ProfileDoc,
    "displayName" | "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultAudience" | "defaultBoardOrExam" | "timezone" | "emailNotifications"
  >
>;

/** True for a time zone name the runtime knows (IANA, e.g. "Asia/Kolkata"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates the user's profile defaults and returns the result. The profile is created first if it doesn't exist yet, so
 * a save can never be lost. Last write wins (profiles have no revision; API Design §8 lists only projects, ideas and
 * posts as concurrently edited).
 */
export async function updateProfile(userId: string, update: ProfileUpdate, displayNameFallback = ""): Promise<ProfileDoc> {
  await getOrCreateProfile(userId, displayNameFallback);
  const set: ProfileUpdate & { updatedAt: Date } = { ...update, updatedAt: new Date() };
  if (update.displayName !== undefined) set.displayName = truncateChars(update.displayName.trim(), 60);
  const res = await collections.profiles().findOneAndUpdate({ userId }, { $set: set }, { returnDocument: "after" });
  return res!;
}
