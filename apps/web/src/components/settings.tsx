"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { ABOUT_MAX_CHARS } from "@/lib/profile-limits";
import { clampChars } from "@/lib/project-client";
import { AUDIENCE_OPTIONS, BOARD_OPTIONS, LANGUAGE_OPTIONS, LENGTH_OPTIONS, VOICE_OPTIONS } from "@/lib/project-options";
import type { ProfileResource } from "@/server/api/resources";
import { Button, Field, Input, Select } from "./ui";

type Profile = ProfileResource;
type Editable = Pick<
  Profile,
  "displayName" | "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultAudience" | "defaultBoardOrExam" | "timezone" | "emailNotifications" | "about"
>;
const KEYS = ["displayName", "defaultLanguage", "defaultLengthPreset", "defaultVoiceGender", "defaultAudience", "defaultBoardOrExam", "timezone", "emailNotifications", "about"] as const;
const editableOf = (p: Profile): Editable => Object.fromEntries(KEYS.map((k) => [k, p[k]])) as Editable;

const TIMEZONES = ["Asia/Kolkata", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles"];

/** Profile & defaults: saves the changed fields with `PATCH /api/v1/me/profile` (API Design §13.1). */
export function ProfileSettingsForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Editable>(editableOf(profile));
  const [draft, setDraft] = useState<Editable>(editableOf(profile));
  const [state, setState] = useState<{ status: "idle" | "saved" | "error"; message?: string }>({ status: "idle" });
  const [pending, start] = useTransition();
  const timezones = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];

  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setState({ status: "idle" });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const changes = Object.fromEntries(KEYS.filter((k) => draft[k] !== saved[k]).map((k) => [k, draft[k]]));
    if (!Object.keys(changes).length) {
      setState({ status: "saved" });
      return;
    }
    start(async () => {
      try {
        const { data } = await apiCall<Profile>("/api/v1/me/profile", { method: "PATCH", body: changes });
        setSaved(editableOf(data));
        setDraft(editableOf(data));
        setState({ status: "saved" });
        // Drops the browser's cached pages, so a Library page visited earlier is fetched again with the new time zone
        // (its dates) on the next visit. This form itself keeps the PATCH response as its state.
        router.refresh();
      } catch (err) {
        const detail = err instanceof ApiClientError ? err.details[0] : undefined;
        const message = err instanceof ApiClientError ? (detail?.field ? `${err.message} (${detail.field}: ${detail.issue})` : err.message) : "Couldn't save. Please try again.";
        setState({ status: "error", message });
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Display name">
          {/* 60 characters counted like the API (an emoji is one), not maxLength's UTF-16 units. */}
          <Input value={draft.displayName} onChange={(e) => set("displayName", clampChars(e.target.value, 60))} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="What do you teach or create about?" hint="Optional — helps the AI suggest ideas for your audience">
          <Input value={draft.about ?? ""} onChange={(e) => set("about", clampChars(e.target.value, ABOUT_MAX_CHARS))} placeholder="e.g. Class 9 science, personal finance, history" />
        </Field>
      </div>
      <Field label="Default language">
        <Select value={draft.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value as Editable["defaultLanguage"])}>
          {LANGUAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Default length">
        <Select value={draft.defaultLengthPreset} onChange={(e) => set("defaultLengthPreset", Number(e.target.value) as 60 | 90)}>
          {LENGTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Default voice">
        <Select value={draft.defaultVoiceGender} onChange={(e) => set("defaultVoiceGender", e.target.value as Editable["defaultVoiceGender"])}>
          {VOICE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Default audience">
        <Select value={draft.defaultAudience} onChange={(e) => set("defaultAudience", e.target.value as Editable["defaultAudience"])}>
          {AUDIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Default board / exam">
        <Select value={draft.defaultBoardOrExam ?? ""} onChange={(e) => set("defaultBoardOrExam", (e.target.value || null) as Editable["defaultBoardOrExam"])}>
          {BOARD_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Time zone" hint="Used for scheduling posts">
        <Select value={draft.timezone} onChange={(e) => set("timezone", e.target.value)}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-3 text-sm sm:col-span-2">
        <input type="checkbox" checked={draft.emailNotifications} onChange={(e) => set("emailNotifications", e.target.checked)} className="size-4 accent-cyan" />
        Email me when a video is ready or a post goes live
      </label>
      <div className="flex items-center gap-4 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {state.status === "saved" ? <span className="font-mono text-sm text-green">saved ✓</span> : null}
        {state.status === "error" ? (
          <span role="alert" className="text-sm text-red">
            {state.message}
          </span>
        ) : null}
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
