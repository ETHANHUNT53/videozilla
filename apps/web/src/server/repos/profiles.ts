import "server-only";
import { ObjectId } from "mongodb";
import { collections, ensureIndexes } from "../db/mongo";
import type { Language, ProfileDoc, VoiceGender } from "../db/types";

/** India-first defaults (PRD §5.1). */
export const DEFAULT_PROFILE = {
  defaultLanguage: "en" as Language,
  defaultLengthPreset: 60 as const,
  defaultVoiceGender: "female" as VoiceGender,
  defaultStyleId: "midnight",
  timezone: "Asia/Kolkata",
  emailNotifications: true,
};

/** Returns the user's profile, creating it with defaults on first use. */
export async function getOrCreateProfile(userId: string, displayName = ""): Promise<ProfileDoc> {
  await ensureIndexes();
  const now = new Date();
  const res = await collections.profiles().findOneAndUpdate(
    { userId },
    { $setOnInsert: { _id: new ObjectId(), userId, displayName, ...DEFAULT_PROFILE, createdAt: now, updatedAt: now } },
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
