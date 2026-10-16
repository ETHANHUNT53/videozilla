import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth-forms";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
