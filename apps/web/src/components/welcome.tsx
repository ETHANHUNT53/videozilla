"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { ABOUT_MAX_CHARS } from "@/lib/profile-limits";
import { clampChars } from "@/lib/project-client";
import type { ProfileResource } from "@/server/api/resources";
import { Button, Logo, cx, inputStyles } from "./ui";

const STEP_CARDS = [
  { n: "01", label: "Idea", text: "Type a topic or paste notes.", foot: "instant structure", color: "text-cyan" },
  { n: "02", label: "Storyboard", text: "Review script + scenes, change anything by chatting.", foot: "scene level tuning", color: "text-violet" },
  { n: "03", label: "Video", text: "Voiceover, synced animation, post to Instagram.", foot: "1080×1920 · 30 fps", color: "text-orange" },
] as const;

const LANGUAGES = [
  { value: "en", label: "English", hint: "Latin script · AI voice in English" },
  { value: "hi", label: "हिंदी (Hindi)", hint: "Devanagari · Hinglish terms where natural" },
] as const;

/**
 * The Welcome screen (F1.12, Stitch screen 16): the three steps, the main video language, an optional "what do you
 * teach or create about", then Start creating (saves them) or Skip. Both mark onboarding done through
 * `PATCH /api/v1/me/profile` and open the Library.
 */
export function WelcomeView({ profile }: { profile: ProfileResource }) {
  const router = useRouter();
  const [language, setLanguage] = useState<"en" | "hi">(profile.defaultLanguage);
  const [about, setAbout] = useState(profile.about ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const firstName = profile.displayName.trim().split(/\s+/)[0];

  const finish = (save: boolean) => {
    setError(null);
    start(async () => {
      try {
        const body = save ? { defaultLanguage: language, about: about.trim() || null, onboardingCompleted: true } : { onboardingCompleted: true };
        await apiCall("/api/v1/me/profile", { method: "PATCH", body });
        router.replace("/library");
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Couldn't save. Please try again.");
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-8">
      <Logo />
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted">
          <span className="text-cyan">{"// "}</span>welcome{firstName ? `, ${firstName}` : ""}
        </span>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">Three steps to your first explainer</h1>
        <p className="text-muted">From a topic to a ready-to-post vertical animation.</p>
      </div>

      <ol className="grid w-full gap-4 sm:grid-cols-3">
        {STEP_CARDS.map((s) => (
          <li key={s.n} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
            <span className={cx("font-mono text-sm", s.color)}>
              {s.n} {s.label}
            </span>
            <p className="flex-1 text-sm">{s.text}</p>
            <span className="border-t border-line pt-3 font-mono text-xs text-dim">→ {s.foot}</span>
          </li>
        ))}
      </ol>

      <form
        className="flex w-full flex-col gap-6 rounded-2xl border border-line bg-surface p-6"
        onSubmit={(e) => {
          e.preventDefault();
          finish(true);
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 flex w-full items-center justify-between text-sm font-medium">
            Which language will most of your videos be in?
            <span className="font-mono text-xs font-normal text-dim">{"// required"}</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {LANGUAGES.map((l) => (
              <label
                key={l.value}
                className={cx(
                  "flex cursor-pointer items-start justify-between gap-3 rounded-xl border p-4",
                  language === l.value ? "border-cyan/60 bg-cyan/5" : "border-line hover:border-line-strong",
                )}
              >
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{l.label}</span>
                  <span className="text-xs text-muted">{l.hint}</span>
                </span>
                <input type="radio" name="language" value={l.value} checked={language === l.value} onChange={() => setLanguage(l.value)} className="mt-1 accent-cyan" />
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between text-sm font-medium">
            What do you teach or create about?
            <span className="font-mono text-xs font-normal text-dim">optional</span>
          </span>
          <input
            value={about}
            // Characters counted like the API (an emoji is one), not maxLength's UTF-16 units.
            onChange={(e) => setAbout(clampChars(e.target.value, ABOUT_MAX_CHARS))}
            placeholder="e.g. Class 9 science, personal finance, history"
            className={inputStyles}
          />
        </label>

        <p className="rounded-xl border border-line px-4 py-2.5 font-mono text-xs text-muted">
          <span className="text-green">●</span> {"// note: "}time zone: {profile.timezone}
          {profile.timezone === "Asia/Kolkata" ? " (IST)" : ""} · change later in Settings
        </p>

        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t border-line pt-5">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => finish(false)}>
            Skip
          </Button>
          <Button type="submit" disabled={pending} className="px-5">
            {pending ? "Saving…" : "Start creating →"}
          </Button>
        </div>
      </form>
    </div>
  );
}
