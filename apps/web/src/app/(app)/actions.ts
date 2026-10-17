"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/dal";
import { updateProfile } from "@/server/repos/profiles";

/*
 * Server actions are public endpoints: each one checks the user itself (Next.js auth guide). Project actions (create,
 * rename, delete, restore, duplicate) use the /api/v1 endpoints instead.
 */

const ProfileForm = z.object({
  displayName: z.string().trim().max(60),
  defaultLanguage: z.enum(["en", "hi"]),
  defaultLengthPreset: z.coerce.number().pipe(z.union([z.literal(60), z.literal(90)])),
  defaultVoiceGender: z.enum(["female", "male"]),
  timezone: z.string().trim().min(1).max(60),
  emailNotifications: z.preprocess((v) => v === "on", z.boolean()),
});

export type ProfileFormState = { status: "idle" | "saved" | "error"; message?: string };

export async function updateProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await requireUser();
  const parsed = ProfileForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields." };
  await updateProfile(user.id, parsed.data);
  revalidatePath("/settings");
  return { status: "saved" };
}
