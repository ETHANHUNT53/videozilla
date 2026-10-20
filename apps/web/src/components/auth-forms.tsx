"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { firstProblem, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, signInSchema, signUpSchema } from "@/lib/auth-schema";
import { SubmitButton } from "./submit-button";
import { Button, Eyebrow, Field, Input } from "./ui";

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red" role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * Better Auth's answers in our words. Wrong email or password says just that (never which one); too many tries says to
 * wait (the server's rate limit, server/auth.ts).
 */
export function authErrorText(error: { status?: number; message?: string; code?: string }, fallback: string): string {
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.status && error.status >= 500) return "Something went wrong on our side. Please try again in a minute.";
  // FAILED_TO_CREATE_USER: two sign-ups with the same email at once; the second hits the unique email index (QA).
  const exists = ["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "FAILED_TO_CREATE_USER"].includes(error.code ?? "");
  if (exists || /already exists|failed to create user/i.test(error.message ?? "")) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) return "That email and password don't match an account.";
  return error.message || fallback;
}

/** Only allow same-site relative paths after sign-in (no open redirects). */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/library";
}

function GoogleButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: "/sign-in?error=google" });
        setBusy(false);
      }}
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
      </svg>
      Continue with Google
    </Button>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 font-mono text-xs text-dim">
      <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(
    params.get("error") === "google" ? "Google sign-in didn't complete. If you made an account with a password for this email, sign in with your password." : null,
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // The same rules as the server (lib/auth-schema.ts), so most mistakes are caught before a request.
    const input = signInSchema.safeParse({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    if (!input.success) return setError(firstProblem(input));
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ ...input.data, callbackURL: next });
    setBusy(false);
    if (error) {
      setError(authErrorText(error, "Couldn't sign you in."));
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>welcome back</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      </div>
      {googleEnabled ? (
        <>
          <GoogleButton next={next} />
          <Divider />
        </>
      ) : null}
      {/* noValidate: our Zod messages show instead of the browser's own tooltip (type="email" still gives phones the
          email keyboard). Editing any field clears the last error. */}
      <form method="post" noValidate onSubmit={onSubmit} onChange={() => setError(null)} className="flex flex-col gap-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required maxLength={254} />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required maxLength={PASSWORD_MAX} />
        </Field>
        <ErrorText message={error} />
        <SubmitButton disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </SubmitButton>
      </form>
      {/* No "Forgot password?" for now (2026-10-20): Videozilla sends no email, so there's no reset link to send. */}
      <div className="flex justify-end text-sm">
        <Link href="/sign-up" className="text-cyan hover:underline">
          Create account
        </Link>
      </div>
    </div>
  );
}

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input = signUpSchema.safeParse({ name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    if (!input.success) return setError(firstProblem(input));
    setBusy(true);
    setError(null);
    // No email step (2026-10-20): the new account is signed in at once; the Library sends a first-time user to Welcome.
    const { error } = await authClient.signUp.email({ ...input.data, callbackURL: "/library" });
    setBusy(false);
    if (error) {
      setError(authErrorText(error, "Couldn't create your account."));
      return;
    }
    router.push("/library");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>get started</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
      </div>
      {googleEnabled ? (
        <>
          <GoogleButton next="/library" />
          <Divider />
        </>
      ) : null}
      {/* noValidate: our Zod messages show instead of the browser's own tooltip (type="email" still gives phones the
          email keyboard). Editing any field clears the last error. */}
      <form method="post" noValidate onSubmit={onSubmit} onChange={() => setError(null)} className="flex flex-col gap-4">
        <Field label="Name">
          <Input name="name" autoComplete="name" required maxLength={NAME_MAX} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required maxLength={254} />
        </Field>
        <Field label="Password" hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters`}>
          <Input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required />
        </Field>
        <ErrorText message={error} />
        <SubmitButton disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </SubmitButton>
      </form>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
