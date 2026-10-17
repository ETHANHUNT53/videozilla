"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "./ui";

/** "+ Create video": `POST /api/v1/projects` (a new idea draft with the profile defaults), then opens the project. */
export function CreateVideoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // POST isn't idempotent (a second call makes a second draft), so a double-click must not send two.
  const inFlight = useRef(false);

  const create = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      if (res.status === 401) {
        // Signed out meanwhile (e.g. a password reset elsewhere): sign in again and come back to the Library.
        router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.id !== "string") throw new Error(body?.error?.message ?? "Couldn't create the video. Please try again.");
      // Drop the cached Library so Back shows the new draft, then open it.
      router.refresh();
      router.push(`/projects/${body.id}`);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't create the video. Check your connection and try again.");
      setBusy(false);
      inFlight.current = false;
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" onClick={create} disabled={busy} className="px-5">
        {busy ? "Creating…" : "+ Create video"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-sm text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
