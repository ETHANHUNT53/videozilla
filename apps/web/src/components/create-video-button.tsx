"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
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
      // apiCall sends a signed-out user to sign-in (401) and turns API errors into a message safe to show.
      const { data } = await apiCall<{ id: string }>("/api/v1/projects", { method: "POST", body: {} });
      // Drop the cached Library so Back shows the new draft, then open it.
      router.refresh();
      router.push(`/projects/${data.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't create the video. Please try again.");
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
