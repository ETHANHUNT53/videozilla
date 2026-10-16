import type { Metadata } from "next";
import { Suspense } from "react";
import { DeleteAccount, ProfileSettingsForm } from "@/components/settings";
import { Card, Chip, Eyebrow, Spinner } from "@/components/ui";
import { requireUser } from "@/server/dal";
import { getOrCreateProfile } from "@/server/repos/profiles";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>settings</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      </div>
      <Suspense fallback={<Spinner />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

async function SettingsContent() {
  const user = await requireUser();
  const profile = await getOrCreateProfile(user.id, user.name);
  return (
    <>
      <Card className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Profile &amp; defaults</h2>
        <p className="mb-5 text-sm text-muted">New videos start with these settings.</p>
        <ProfileSettingsForm
          profile={{
            displayName: profile.displayName,
            defaultLanguage: profile.defaultLanguage,
            defaultLengthPreset: profile.defaultLengthPreset,
            defaultVoiceGender: profile.defaultVoiceGender,
            timezone: profile.timezone,
            emailNotifications: profile.emailNotifications,
          }}
        />
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">Instagram</h2>
          <p className="text-sm text-muted">Connect a Creator or Business account to post and schedule Reels.</p>
        </div>
        <Chip color="#8a92a3">coming in M6</Chip>
      </Card>

      <Card className="flex flex-col gap-4 border-red/25 p-6">
        <div>
          <h2 className="text-lg font-semibold">Delete account</h2>
          <p className="text-sm text-muted">Permanently deletes your account, all videos and settings. This can&apos;t be undone.</p>
        </div>
        <DeleteAccount email={user.email} />
      </Card>
    </>
  );
}
