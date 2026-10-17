"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiCall } from "@/lib/api-client";
import type { AutosaveState } from "@/lib/autosave";
import { clampChars } from "@/lib/project-client";
import { useAutosave } from "@/lib/use-autosave";
import type { IdeaSessionResource } from "@/server/api/resources";
import { Button, Card, Eyebrow, cx, inputStyles } from "./ui";

type Idea = IdeaSessionResource;
type Mode = Idea["mode"];
type Draft = Pick<Idea, "mode" | "topicInput" | "ideaInput" | "notesText">;

/** Same limits as the API and the database (characters, so an emoji or a Hindi letter is one). */
const LIMITS = { topicInput: 200, ideaInput: 500, notesText: 20_000 } as const;

const TABS: { mode: Mode; label: string; field: keyof typeof LIMITS }[] = [
  { mode: "topic", label: "Find a topic", field: "topicInput" },
  { mode: "idea", label: "I have an idea", field: "ideaInput" },
  { mode: "notes", label: "Use my notes", field: "notesText" },
];

const draftOf = (i: Idea): Draft => ({ mode: i.mode, topicInput: i.topicInput, ideaInput: i.ideaInput, notesText: i.notesText });
const count = (s: string) => Array.from(s).length;

/**
 * The Idea step (PRD F2, first part — F2.1): three ways to start, each with its own text, autosaved through
 * `PUT /api/v1/projects/{id}/idea`. The AI actions arrive in F2.2–F2.4; F2.7 restyles this as Stitch screen 09.
 */
export function IdeaStep({ projectId, initial, editable }: { projectId: string; initial: Idea; editable: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [clipped, setClipped] = useState<keyof typeof LIMITS | null>(null);
  const { state, queue } = useAutosave<Draft, Idea>({
    rev: initial.rev,
    save: async (value, rev) =>
      (await apiCall<Idea>(`/api/v1/projects/${projectId}/idea`, { method: "PUT", body: value, headers: { "If-Match": `"${rev}"` } })).data,
  });

  const update = (next: Draft) => {
    setDraft(next);
    queue.change(next);
  };

  const setText = (field: keyof typeof LIMITS, raw: string) => {
    const value = clampChars(raw, LIMITS[field]);
    setClipped(value.length < raw.length ? field : null);
    update({ ...draft, [field]: value });
  };

  const tab = TABS.find((t) => t.mode === draft.mode) ?? TABS[0];
  const conflict = state.status === "conflict" ? state.conflict : undefined;

  return (
    <Card className="flex min-h-80 flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow accent="text-violet">idea studio</Eyebrow>
        <SaveStatus state={state} />
      </div>

      <div role="tablist" aria-label="How do you want to start?" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-raised p-1">
        {TABS.map((t) => (
          <button
            key={t.mode}
            type="button"
            role="tab"
            id={`idea-tab-${t.mode}`}
            aria-selected={t.mode === draft.mode}
            aria-controls="idea-panel"
            disabled={!editable}
            onClick={() => t.mode !== draft.mode && update({ ...draft, mode: t.mode })}
            className={cx(
              "rounded-lg px-2 py-2 text-sm transition-colors",
              t.mode === draft.mode ? "bg-surface font-medium text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="idea-panel" aria-labelledby={`idea-tab-${tab.mode}`} className="flex flex-col gap-3">
        {tab.mode === "topic" ? (
          <TextBox
            label="What subject or niche?"
            hint="For example: photosynthesis for Class 7, or personal finance basics. The AI will suggest 5 video ideas."
            value={draft.topicInput}
            max={LIMITS.topicInput}
            onChange={(v) => setText("topicInput", v)}
            readOnly={!editable}
          />
        ) : tab.mode === "idea" ? (
          <TextBox
            label="Describe your idea"
            hint="A sentence or two is enough. The AI will sharpen it into a brief and suggest 2 other angles."
            value={draft.ideaInput}
            max={LIMITS.ideaInput}
            rows={4}
            onChange={(v) => setText("ideaInput", v)}
            readOnly={!editable}
          />
        ) : (
          <TextBox
            label="Paste your notes"
            hint="Any language. The AI will pick one focus that fits 60–90 seconds and say what it leaves out."
            value={draft.notesText}
            max={LIMITS.notesText}
            rows={12}
            onChange={(v) => setText("notesText", v)}
            readOnly={!editable}
          />
        )}
        {clipped === tab.field ? (
          <p role="status" className="text-sm text-orange">
            That was longer than {LIMITS[tab.field].toLocaleString("en-IN")} characters, so the end was cut off.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled title="Arrives in the next update">
            {tab.mode === "topic" ? "Suggest 5 ideas" : tab.mode === "idea" ? "Sharpen my idea" : "Turn my notes into a brief"}
          </Button>
          <span className="font-mono text-xs text-dim">{"// AI planning arrives next"}</span>
        </div>
      </div>

      {conflict ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-orange/40 bg-orange/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">This idea was changed in another tab. Your latest typing isn&apos;t saved yet.</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const latest = draftOf(conflict);
                setDraft(latest);
                queue.loadLatest(latest, conflict.rev);
              }}
            >
              Load latest
            </Button>
            <Button type="button" onClick={() => queue.keepMine()}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === "error" && state.stopped ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red/40 bg-red/5 px-4 py-3">
          <span className="text-sm">{state.error}</span>
          <Button type="button" variant="secondary" onClick={() => router.refresh()}>
            Reload
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function TextBox(props: { label: string; hint: string; value: string; max: number; rows?: number; readOnly: boolean; onChange: (v: string) => void }) {
  const used = count(props.value);
  const common = {
    value: props.value,
    readOnly: props.readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.onChange(e.target.value),
    className: cx(inputStyles, props.rows !== undefined && "resize-y leading-relaxed"),
    "aria-describedby": "idea-hint idea-count",
  };
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{props.label}</span>
      {props.rows ? <textarea rows={props.rows} {...common} /> : <input type="text" {...common} />}
      <span className="flex justify-between gap-3 text-xs text-dim">
        <span id="idea-hint">{props.hint}</span>
        <span id="idea-count" className={cx("shrink-0 font-mono", used >= props.max && "text-orange")}>
          {used.toLocaleString("en-IN")} / {props.max.toLocaleString("en-IN")}
        </span>
      </span>
    </label>
  );
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline — will save when reconnected",
  conflict: "Not saved — changed in another tab",
};

function SaveStatus({ state }: { state: AutosaveState<Idea> }) {
  const text = state.status === "error" ? (state.stopped ? "Not saved" : `Not saved — ${state.error ?? "trying again"}`) : STATUS_TEXT[state.status];
  if (!text) return null;
  const tone = state.status === "saved" ? "text-cyan" : state.status === "pending" || state.status === "saving" ? "text-muted" : "text-orange";
  return (
    <span role="status" aria-live="polite" className={cx("font-mono text-xs", tone)}>
      {text}
    </span>
  );
}
