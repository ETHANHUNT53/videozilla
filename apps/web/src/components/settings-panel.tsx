"use client";

import { useRef, useState, useTransition } from "react";
import { ApiClientError } from "@/lib/api-client";
import { conflictCopy, currentNote, patchProject, type RevNote } from "@/lib/project-client";
import { AUDIENCE_OPTIONS, BOARD_OPTIONS, STYLE_LABELS, VOICE_OPTIONS } from "@/lib/project-options";
import type { ProjectResource } from "@/server/api/resources";
import { SegmentedControl } from "./segmented";
import { Card, Eyebrow, Select, cx } from "./ui";

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
  // The value being saved, shown before the server answers; cleared when it does.
  const [optimistic, setOptimistic] = useState<Partial<Settings>>({});
  // Tied to the revision it is about: a later save (or rename) hides it.
  const [revMessage, setMessage] = useState<RevNote<{ tone: "info" | "error"; text: string }> | null>(null);
  const message = currentNote(revMessage, project);
  const [pending, start] = useTransition();
  // One save at a time, also for two clicks that land before React re-renders with `pending`.
  const saving = useRef(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const scriptEditable = project.allowedActions.includes("edit_script_settings");
  const mediaEditable = project.allowedActions.includes("edit_media_settings");
  const shown: Settings = { ...settingsOf(project), ...optimistic };
  // While a save runs the controls stay enabled (`change` ignores input until it answers): disabling them would drop
  // keyboard focus to the page after every arrow key or selection, so a keyboard user couldn't go on (F2.7 review).

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (pending || saving.current || settingsOf(project)[key] === value) return;
    saving.current = true;
    setMessage(null);
    setSavedAt(null);
    setOptimistic({ [key]: value } as Partial<Settings>);
    start(async () => {
      try {
        const { project: next, requiresRegeneration } = await patchProject<Project>(project, { [key]: value } as Partial<Settings>);
        onSaved(next);
        setSavedAt(Date.now());
        if (requiresRegeneration) {
          setMessage({ value: { tone: "info", text: "Saved. Regenerate the storyboard to use the new settings." }, rev: next.rev, status: next.status });
        } else if (next.exportOutdated && !project.exportOutdated) {
          setMessage({ value: { tone: "info", text: "Saved. Rebuild or re-export the video to apply it." }, rev: next.rev, status: next.status });
        }
      } catch (err) {
        const latest = conflictCopy<Project>(err);
        if (latest) {
          onSaved(latest);
          setMessage({ value: { tone: "error", text: "This video was changed in another tab, so your change wasn't saved. We loaded the latest settings — choose again if you still want it." }, rev: latest.rev });
        } else {
          setMessage({ value: { tone: "error", text: err instanceof ApiClientError ? err.message : "Couldn't save that setting. Please try again." }, rev: project.rev });
        }
      } finally {
        saving.current = false;
        setOptimistic({});
      }
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-5" aria-busy={pending}>
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>settings</Eyebrow>
        <span role="status" aria-live="polite" className={cx("font-mono text-xs", pending ? "text-muted" : "text-cyan")}>
          {pending ? "Saving…" : savedAt ? "Saved ✓" : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SegmentedControl label="language" options={LANGUAGE_SEGMENTS} value={shown.language} disabled={!scriptEditable} onChange={(v) => change("language", v)} />
        <SegmentedControl label="duration" options={LENGTH_SEGMENTS} value={shown.lengthPreset} disabled={!scriptEditable} onChange={(v) => change("lengthPreset", v)} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">{"// audience"}</span>
        <Select value={shown.audience} disabled={!scriptEditable} onChange={(e) => change("audience", e.target.value)}>
          {AUDIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">{"// board or exam"}</span>
        <Select value={shown.boardOrExam ?? ""} disabled={!scriptEditable} onChange={(e) => change("boardOrExam", (e.target.value || null) as Settings["boardOrExam"])}>
          {BOARD_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>

      <fieldset className="flex flex-col gap-1.5" disabled={!mediaEditable}>
        <legend className="mb-1.5 font-mono text-xs text-muted">{"// voice narrator"}</legend>
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
        <span className="font-mono text-xs text-muted">{"// captions"}</span>
        <span className="flex items-center gap-2">
          <input type="checkbox" checked={shown.captionsEnabled} disabled={!mediaEditable} onChange={(e) => change("captionsEnabled", e.target.checked)} className="size-4 accent-cyan" />
          {shown.captionsEnabled ? "On" : "Off"}
        </span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-muted">{"// visual style"}</span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs">
          <span aria-hidden className="size-1.5 rounded-full bg-cyan" />
          {STYLE_LABELS[project.styleId] ?? project.styleId}
        </span>
      </div>

      {!scriptEditable || !mediaEditable ? (
        <p className="text-xs text-muted">
          {!scriptEditable ? "Language, length, audience and board can't change once the video is built — duplicate it to try different ones. " : ""}
          {!mediaEditable ? "Voice and captions can be chosen once the storyboard is ready." : ""}
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
