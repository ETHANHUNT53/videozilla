import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { WelcomeView } from "@/components/welcome";
import { toProfile } from "@/server/api/resources";
import { requireUser } from "@/server/dal";
import { getOrCreateProfile } from "@/server/repos/profiles";

export const metadata: Metadata = { title: "Welcome" };

/** First-run onboarding (F1.12, PRD S2 / F1-FR4, Stitch screen 16). The Library sends new users here once. */
export default function WelcomePage() {
  return (
    <main className="relative flex flex-1 justify-center overflow-hidden px-6 py-14">
      <div className="dot-field pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-3xl">
        <Suspense fallback={<Spinner />}>
          <WelcomeContent />
        </Suspense>
      </div>
    </main>
  );
}

async function WelcomeContent() {
  const user = await requireUser();
  const profile = await getOrCreateProfile(user.id, user.name);
  // Already done (or skipped): nothing to show again.
  if (profile.onboardingCompletedAt) redirect("/library");
  return <WelcomeView profile={toProfile(profile)} />;
}
