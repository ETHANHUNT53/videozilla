"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Eyebrow, Field, Input } from "./ui";

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red" role="alert">
      {message}
    </p>
  ) : null;
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
  const [error, setError] = useState<string | null>(params.get("error") === "google" ? "Google sign-in didn't complete. Please try again." : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")), callbackURL: next });
    setBusy(false);
    if (error) {
      if (error.status === 403) {
        router.push(`/verify-email?email=${encodeURIComponent(String(form.get("email")))}`);
        return;
      }
      setError(error.message ?? "Couldn't sign you in.");
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
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <ErrorText message={error} />
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted hover:text-fg">
          Forgot password?
        </Link>
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
    const email = String(form.get("email"));
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name: String(form.get("name")), email, password: String(form.get("password")), callbackURL: "/library" });
    setBusy(false);
    if (error) {
      setError(error.status >= 500 ? "Something went wrong on our side, so your account wasn't created. Please try again in a minute." : (error.message ?? "Couldn't create your account."));
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
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
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Name">
          <Input name="name" autoComplete="name" required maxLength={60} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <ErrorText message={error} />
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
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

export function VerifyEmailNotice() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  return (
    <div className="flex flex-col gap-5">
      <Eyebrow accent="text-orange">one more step</Eyebrow>
      <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
      <p className="text-muted">
        We sent a verification link{email ? <> to <span className="text-fg">{email}</span></> : null}. Open it to activate your account — you&apos;ll be signed
        in automatically.
      </p>
      {email ? (
        <Button
          variant="secondary"
          disabled={state === "sending" || state === "sent"}
          onClick={async () => {
            setState("sending");
            const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/library" });
            setState(error ? "error" : "sent");
          }}
        >
          {state === "sent" ? "Sent again ✓" : state === "sending" ? "Sending…" : "Resend verification email"}
        </Button>
      ) : null}
      {state === "error" ? <ErrorText message="Couldn't resend right now. Please try again in a minute." /> : null}
      <Link href="/sign-in" className="text-sm text-muted hover:text-fg">
        ← Back to sign in
      </Link>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setState("sending");
    // Same response whether or not the account exists, so emails can't be probed.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setState("sent");
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>password reset</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight">Forgot your password?</h1>
      </div>
      {state === "sent" ? (
        <p className="text-muted">If an account exists for that email, a reset link is on its way. It expires in an hour.</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Email">
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <Link href="/sign-in" className="text-sm text-muted hover:text-fg">
        ← Back to sign in
      </Link>
    </div>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(params.get("error") ? "This reset link is invalid or has expired. Request a new one." : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword: String(new FormData(e.currentTarget).get("password")), token });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Couldn't reset your password.");
      return;
    }
    router.push("/sign-in");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>password reset</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      </div>
      {token ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="New password" hint="At least 8 characters">
            <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <ErrorText message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      ) : (
        <ErrorText message={error ?? "This reset link is missing its token. Request a new one."} />
      )}
    </div>
  );
}
