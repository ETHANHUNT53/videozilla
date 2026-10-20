"use client";

import { useEffect, useId, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { addPoint, briefEdits, MAX_KEY_POINTS, movePoint, removePoint } from "@/lib/key-points";
import type { IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { Button, cx, inputStyles } from "./ui";

type Brief = NonNullable<IdeaSessionResource["brief"]>;
/** `PATCH …/idea/brief` (F2.8): the idea session plus the project (its title may have followed the brief). */
export type BriefEditReply = IdeaSessionResource & { project: ProjectResource };

/** Same limits as the API (characters, so an emoji or a Hindi letter is one). */
const LIMIT = { title: 80, hook: 200, angle: 300, point: 160 } as const;
const count = (s: string) => Array.from(s).length;
const clamp = (s: string, max: number) => Array.from(s).slice(0, max).join("");

/**
 * Edit the brief directly (F2.8, PRD F2-FR7): its text fields, Save or Cancel. No AI call. Saved against the brief it
 * was opened on (`briefUpdatedAt`): if a chat answer, another angle or another tab changed the brief meanwhile, the
 * save is refused (412) and the bar offers Load latest (drop my edits) or Keep mine (save them over it).
 */
export function BriefEditor(props: {
  projectId: string;
  brief: Brief;
  briefUpdatedAt: string | null;
  onSaved: (reply: BriefEditReply) => void;
  onCancel: () => void;
  /** Load latest after a conflict: the current idea from the 412. */
  onLatest: (idea: IdeaSessionResource) => void;
}) {
  const { projectId, brief, onSaved, onCancel, onLatest } = props;
  const id = useId();
  const [draft, setDraft] = useState({ title: brief.title, hook: brief.hook, angle: brief.angle, keyPoints: [...brief.keyPoints], outOfScope: [...brief.outOfScope] });
  const [basedOn, setBasedOn] = useState(props.briefUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<IdeaSessionResource | null>(null);
  const edits = briefEdits(brief, draft);
  const dirty = Object.keys(edits).length > 0;

  // Leaving with unsaved edits asks first, like the idea text boxes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async (on: string | null) => {
    if (!dirty) return onCancel();
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiCall<BriefEditReply>(`/api/v1/projects/${projectId}/idea/brief`, { method: "PATCH", body: { briefUpdatedAt: on, ...edits } });
      onSaved(data);
    } catch (err) {
      const current = err instanceof ApiClientError && err.code === "PRECONDITION_FAILED" ? (err.details[0]?.current as IdeaSessionResource | undefined) : undefined;
      if (current) {
        setConflict(current);
        setBasedOn(current.briefUpdatedAt);
      } else setError(err instanceof ApiClientError ? (err.details[0]?.field ? `${err.message} (${err.details[0].field}: ${err.details[0].issue})` : err.message) : "Couldn't save the brief. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: "title" | "hook" | "angle", label: string, max: number, rows?: number) => {
    const used = count(draft[key]);
    const props = {
      id: `${id}-${key}`,
      value: draft[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [key]: clamp(e.target.value, max) })),
      "aria-describedby": `${id}-${key}-count`,
      className: cx(inputStyles, rows !== undefined && "resize-y leading-relaxed"),
    };
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-${key}`} className="text-sm text-muted">
          {label}
        </label>
        {rows ? <textarea rows={rows} {...props} /> : <input type="text" {...props} />}
        <span id={`${id}-${key}-count`} className={cx("self-end font-mono text-xs text-muted", used >= max && "text-orange")}>
          {used} / {max}
        </span>
      </div>
    );
  };

  const list = (key: "keyPoints" | "outOfScope", label: string) => {
    const items = draft[key];
    const set = (next: string[]) => setDraft((d) => ({ ...d, [key]: next }));
    const ordered = key === "keyPoints";
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">{label}</legend>
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{ordered ? `${i + 1}.` : "–"}</span>
            <input
              type="text"
              value={item}
              aria-label={`${ordered ? "Key point" : "Left out"} ${i + 1}`}
              onChange={(e) => set(items.map((x, j) => (j === i ? clamp(e.target.value, LIMIT.point) : x)))}
              className={cx(inputStyles, "min-w-0 flex-1")}
            />
            {ordered ? (
              <>
                <Button type="button" variant="ghost" className="px-2" disabled={i === 0} aria-label={`Move key point ${i + 1} up`} onClick={() => set(movePoint(items, i, -1))}>
                  ↑
                </Button>
                <Button type="button" variant="ghost" className="px-2" disabled={i === items.length - 1} aria-label={`Move key point ${i + 1} down`} onClick={() => set(movePoint(items, i, 1))}>
                  ↓
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="px-2"
              disabled={ordered && items.length <= 1}
              aria-label={`Remove ${ordered ? "key point" : "left-out item"} ${i + 1}`}
              onClick={() => set(ordered ? removePoint(items, i) : items.filter((_, j) => j !== i))}
            >
              ✕
            </Button>
          </div>
        ))}
        {items.length < MAX_KEY_POINTS ? (
          <Button type="button" variant="ghost" className="self-start text-sm" onClick={() => set(ordered ? addPoint(items) : [...items, ""])}>
            {ordered ? "+ Add a point" : "+ Add an item"}
          </Button>
        ) : null}
      </fieldset>
    );
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4 rounded-xl border border-cyan/40 bg-cyan/5 p-5">
      <h3 id={`${id}-heading`} className="font-mono text-sm text-cyan">
        {"// edit your brief"}
      </h3>
      {conflict ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-orange/40 bg-orange/5 px-4 py-3">
          <span className="text-sm">The brief changed while you were editing (a chat answer, another angle or another tab). Your edits aren&apos;t saved yet.</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => onLatest(conflict)}>
              Load latest
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save(basedOn)}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
      {field("title", "Title", LIMIT.title)}
      {field("hook", "Hook (the narrator's first sentence)", LIMIT.hook, 2)}
      {field("angle", "Angle", LIMIT.angle, 2)}
      {list("keyPoints", "Key points, in teaching order (1 to 5)")}
      {list("outOfScope", "Left out to fit the length")}
      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={saving || !!conflict} onClick={() => void save(basedOn)}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        {!dirty ? <span className="text-xs text-muted">No changes yet.</span> : null}
      </div>
    </section>
  );
}
