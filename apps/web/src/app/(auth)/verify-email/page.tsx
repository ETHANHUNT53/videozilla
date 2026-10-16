import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailNotice } from "@/components/auth-forms";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <VerifyEmailNotice />
    </Suspense>
  );
}
