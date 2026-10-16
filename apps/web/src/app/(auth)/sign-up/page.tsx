import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-forms";
import { SignedInRedirect } from "@/components/signed-in-redirect";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <>
      <SignedInRedirect />
      <SignUpForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />
    </>
  );
}
