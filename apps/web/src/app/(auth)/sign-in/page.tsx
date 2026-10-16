import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth-forms";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <SignedInRedirect />
      <Suspense fallback={<Spinner />}>
        <SignInForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />
      </Suspense>
    </>
  );
}
