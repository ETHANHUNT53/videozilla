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

export type ProfileUpdate = Partial<
  Pick<ProfileDoc, "displayName" | "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultStyleId" | "timezone" | "emailNotifications">
>;

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
  await collections.profiles().updateOne({ userId }, { $set: { ...update, updatedAt: new Date() } });
}
