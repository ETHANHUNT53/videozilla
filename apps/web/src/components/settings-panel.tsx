"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { conflictCopy, currentNote, patchProject, type RevNote } from "@/lib/project-client";
import { createSaveQueue } from "@/lib/save-queue";
import { AUDIENCE_OPTIONS, BOARD_OPTIONS, STYLE_LABELS, VOICE_OPTIONS } from "@/lib/project-options";
import type { ProjectResource } from "@/server/api/resources";
import { SegmentedControl } from "./segmented";
import { Card, Eyebrow, Select, Slashes, cx } from "./ui";

type Project = ProjectResource;
type Settings = Pick<Project, "language" | "lengthPreset" | "audience" | "boardOrExam" | "voiceGender" | "captionsEnabled">;

const settingsOf = (p: Project): Settings => ({
  language: p.language,
  lengthPreset: p.lengthPreset,
  audience: p.audience,
  boardOrExam: p.boardOrExam,
  voiceGender: p.voiceGender,
  captionsEnabled: p.captionsEnabled,
});

/** Stitch 09's short labels for the segmented controls. */
const LANGUAGE_SEGMENTS = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिंदी" },
] as const;
const LENGTH_SEGMENTS = [
  { value: 60, label: "~60s" },
  { value: 90, label: "~90s" },
] as const;

/**
 * The video's settings (PRD F2-FR6, Stitch 09; F2.7: always-on controls, your answer). Each change is saved at once
 * through `PATCH /api/v1/projects/{id}` with `If-Match`, one change at a time: the control shows the new value at once
 * and goes back if the save fails. Another tab's change (412) loads the latest settings and says the change wasn't
 * saved. Fields lock by stage from the project's `allowedActions`, as before (F2.6).
 */
export function SettingsPanel({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  // Values chosen but not saved yet (being saved, or waiting for the save before them), shown at once.
  const [optimistic, setOptimistic] = useState<Partial<Settings>>({});
  // Tied to the revision it is about: a later save (or rename) hides it.
  const [revMessage, setMessage] = useState<RevNote<{ tone: "info" | "error"; text: string }> | null>(null);
  const message = currentNote(revMessage, project);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const scriptEditable = project.allowedActions.includes("edit_script_settings");
  const mediaEditable = project.allowedActions.includes("edit_media_settings");
  const shown: Settings = { ...settingsOf(project), ...optimistic };
  // The newest project for each save's If-Match (a queued save runs after the one before it has answered), and the
  // newest onSaved; kept in refs because the queue lives across renders.
  const latest = useRef(project);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    latest.current = project;
    onSavedRef.current = onSaved;
  });

  // While a save runs the controls stay enabled (disabling them would drop keyboard focus after every key). Changes
  // made meanwhile wait in a queue, newest value per setting, and go out together when the save before them answers
  // (F2.7 QA: two quick arrow presses, or a held key, end where focus ends). One PATCH at a time.
  // Made on the first change (in the handler, not during render) and kept for the panel's life.
  const queueRef = useRef<ReturnType<typeof createSaveQueue<Settings>> | null>(null);
  const makeQueue = () => {
    const q = createSaveQueue<Settings>(
      async (wanted) => {
        const current = latest.current;
        const changes = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => settingsOf(current)[k as keyof Settings] !== v)) as Partial<Settings>;
        if (!Object.keys(changes).length) return; // back to what's saved: nothing to send
        try {
          const { project: next, requiresRegeneration } = await patchProject<Project>(current, changes);
          latest.current = next;
          onSavedRef.current(next);
          setSavedAt(Date.now());
          if (requiresRegeneration) {
            setMessage({ value: { tone: "info", text: "Saved. Regenerate the storyboard to use the new settings." }, rev: next.rev, status: next.status });
          } else if (next.exportOutdated && !current.exportOutdated) {
            setMessage({ value: { tone: "info", text: "Saved. Rebuild or re-export the video to apply it." }, rev: next.rev, status: next.status });
          }
        } catch (err) {
          // Whatever was chosen after this was chosen on top of it: drop it too, and show what's really saved.
          q.cancel();
          const fresh = conflictCopy<Project>(err);
          if (fresh) {
            latest.current = fresh;
            onSavedRef.current(fresh);
            setMessage({ value: { tone: "error", text: "This video was changed in another tab, so your change wasn't saved. We loaded the latest settings — choose again if you still want it." }, rev: fresh.rev });
          } else {
            setMessage({ value: { tone: "error", text: err instanceof ApiClientError ? err.message : "Couldn't save that setting. Please try again." }, rev: current.rev });
          }
        }
      },
      () => {
        setBusy(false);
        setOptimistic({});
      },
    );
    return q;
  };

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (shown[key] === value) return;
    setMessage(null);
    setSavedAt(null);
    setBusy(true);
    setOptimistic((o) => ({ ...o, [key]: value }));
    queueRef.current ??= makeQueue();
    void queueRef.current.push({ [key]: value } as Partial<Settings>);
  };

  return (
    <Card className="flex flex-col gap-4 p-5" aria-busy={busy}>
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>settings</Eyebrow>
        <span role="status" aria-live="polite" className={cx("font-mono text-xs", busy ? "text-muted" : "text-cyan")}>
          {busy ? "Saving…" : savedAt ? "Saved ✓" : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SegmentedControl label="language" options={LANGUAGE_SEGMENTS} value={shown.language} disabled={!scriptEditable} onChange={(v) => change("language", v)} />
        <SegmentedControl label="duration" options={LENGTH_SEGMENTS} value={shown.lengthPreset} disabled={!scriptEditable} onChange={(v) => change("lengthPreset", v)} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted"><Slashes />
          audience</span>
        <Select value={shown.audience} disabled={!scriptEditable} onChange={(e) => change("audience", e.target.value)}>
          {AUDIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted"><Slashes />
          board or exam</span>
        <Select value={shown.boardOrExam ?? ""} disabled={!scriptEditable} onChange={(e) => change("boardOrExam", (e.target.value || null) as Settings["boardOrExam"])}>
          {BOARD_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>

      <fieldset className="flex flex-col gap-1.5" disabled={!mediaEditable}>
        <legend className="mb-1.5 font-mono text-xs text-muted"><Slashes />
          voice narrator</legend>
        <div className="grid grid-cols-2 gap-2">
          {VOICE_OPTIONS.map((o) => {
            const selected = shown.voiceGender === o.value;
            return (
              <label
                key={o.value}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan/60",
                  selected ? "border-cyan/60 bg-cyan/5 text-fg" : "border-line bg-raised text-muted hover:text-fg",
                )}
              >
                <input type="radio" name="voice" value={o.value} checked={selected} onChange={() => change("voiceGender", o.value)} className="sr-only" />
                <span aria-hidden className={cx("size-2 rounded-full", selected ? "bg-cyan shadow-[0_0_8px_var(--cyan)]" : "bg-dim")} />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className={cx("flex items-center justify-between gap-3 text-sm", (!mediaEditable) && "opacity-60")}>
        <span className="font-mono text-xs text-muted"><Slashes />
          captions</span>
        <span className="flex items-center gap-2">
          <input type="checkbox" checked={shown.captionsEnabled} disabled={!mediaEditable} onChange={(e) => change("captionsEnabled", e.target.checked)} className="size-4 accent-cyan" />
          {shown.captionsEnabled ? "On" : "Off"}
        </span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-muted"><Slashes />
          visual style</span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs">
          <span aria-hidden className="size-1.5 rounded-full bg-cyan" />
          {STYLE_LABELS[project.styleId] ?? project.styleId}
        </span>
      </div>

      {!scriptEditable || !mediaEditable ? (
        <p className="text-xs text-muted">
          {project.status === "storyboard_generating"
            ? "Settings are locked while your storyboard is being written. They unlock when it's ready."
            : (!scriptEditable ? "Language, length, audience and board can't change once the video is built — duplicate it to try different ones. " : "") +
              (!mediaEditable ? "Voice and captions can be chosen once the storyboard is ready." : "")}
        </p>
      ) : null}

      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cx("text-sm", message.tone === "error" ? "text-red" : "text-cyan")}>
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}
