"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/dal";
import { createProject, duplicateProject, renameProject, restoreProject, softDeleteProject } from "@/server/repos/projects";
import { getOrCreateProfile, updateProfile } from "@/server/repos/profiles";

/* Server actions are public endpoints: each one checks the user itself (Next.js auth guide). */

export async function createProjectAction() {
  const user = await requireUser();
  const profile = await getOrCreateProfile(user.id, user.name);
  const id = await createProject(user.id, profile);
  revalidatePath("/library");
  redirect(`/projects/${id}`);
}

export async function renameProjectAction(id: string, title: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const ok = await renameProject(user.id, id, title);
  revalidatePath("/library");
  revalidatePath(`/projects/${id}`);
  return { ok };
}

export async function deleteProjectAction(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const ok = await softDeleteProject(user.id, id);
  revalidatePath("/library");
  return { ok };
}

export async function restoreProjectAction(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const ok = await restoreProject(user.id, id);
  revalidatePath("/library");
  return { ok };
}

export async function duplicateProjectAction(id: string): Promise<{ id: string | null }> {
  const user = await requireUser();
  const newId = await duplicateProject(user.id, id);
  revalidatePath("/library");
  return { id: newId };
}

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
