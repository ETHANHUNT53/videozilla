"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { updateProfileAction, type ProfileFormState } from "@/app/(app)/actions";
import { authClient } from "@/lib/auth-client";
import { Button, Field, Input, Select } from "./ui";

interface ProfileValues {
  displayName: string;
  defaultLanguage: "en" | "hi";
  defaultLengthPreset: 60 | 90;
  defaultVoiceGender: "female" | "male";
  timezone: string;
  emailNotifications: boolean;
}

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles"];

export function ProfileSettingsForm({ profile }: { profile: ProfileValues }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(updateProfileAction, { status: "idle" });
  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Display name">
          <Input name="displayName" defaultValue={profile.displayName} maxLength={60} />
        </Field>
      </div>
      <Field label="Default language">
        <Select name="defaultLanguage" defaultValue={profile.defaultLanguage}>
          <option value="en">English</option>
          <option value="hi">हिंदी (Hindi)</option>
        </Select>
      </Field>
      <Field label="Default length">
        <Select name="defaultLengthPreset" defaultValue={String(profile.defaultLengthPreset)}>
          <option value="60">~60 seconds</option>
          <option value="90">~90 seconds</option>
        </Select>
      </Field>
      <Field label="Default voice">
        <Select name="defaultVoiceGender" defaultValue={profile.defaultVoiceGender}>
          <option value="female">Female voice</option>
          <option value="male">Male voice</option>
        </Select>
      </Field>
      <Field label="Time zone" hint="Used for scheduling posts">
        <Select name="timezone" defaultValue={profile.timezone}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-3 text-sm sm:col-span-2">
        <input type="checkbox" name="emailNotifications" defaultChecked={profile.emailNotifications} className="size-4 accent-cyan" />
        Email me when a video is ready or a post goes live
      </label>
      <div className="flex items-center gap-4 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {state.status === "saved" ? <span className="font-mono text-sm text-green">saved ✓</span> : null}
        {state.status === "error" ? <span className="text-sm text-red">{state.message}</span> : null}
      </div>
    </form>
  );
}

export function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label='Type "DELETE" to confirm'>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={`Confirm deleting the account ${email}`} />
      </Field>
      <Button
        variant="danger"
        disabled={confirm !== "DELETE" || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const { error } = await authClient.deleteUser({ callbackURL: "/" });
          setBusy(false);
          if (error) {
            setError(error.message ?? "For your security, sign out and sign in again, then retry.");
            return;
          }
          router.push("/");
          router.refresh();
        }}
      >
        {busy ? "Deleting…" : "Delete my account"}
      </Button>
      {error ? <p className="w-full text-sm text-red">{error}</p> : null}
    </div>
  );
}
