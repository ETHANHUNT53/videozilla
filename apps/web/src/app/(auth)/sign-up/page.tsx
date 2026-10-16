import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return <SignUpForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />;
}
