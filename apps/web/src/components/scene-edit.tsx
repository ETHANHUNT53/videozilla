"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- scene props differ per scene type; the form is driven by SCENE_FORMS. */
import { cleanProps, editedSceneSec, FLOW_EDGES, lengthLabel, newListItem, problemText, SCENE_FORMS, sceneProblems, switchSceneType, type FieldSpec, type SceneOp } from "@videozilla/pipeline";
import { SCENE_TYPES, type Scene, type SceneType, type Storyboard } from "@videozilla/schema";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SceneDraft } from "@/lib/scene-draft";
import { Button, cx, inputStyles } from "./ui";

/**
 * The edit form of one scene card (F3.6): narration, headlines, the scene type (by hand: switching converts what carries
 * over and leaves the rest empty, your answer) and that type's own fields (SCENE_FORMS, within its schema limits). Save
 * stays off until the scene is valid, with the reasons listed. See docs/features/F3.6-scene-edits.md.
 */

const TYPE_LABEL: Record<SceneType, string> = {
  TitleHook: "Title hook",
  KeywordReveal: "Keywords",
  BulletSteps: "Bullet steps",
  Flowchart: "Flowchart",
  Comparison: "Comparison",
  StatCounter: "Big number",
  RecapOutro: "Recap + call to action",
  Illustration: "Illustration",
  UnitGrid: "Unit grid",
};

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function SceneEditForm(props: {
  scene: Scene;
  /** The storyboard the scene is in, for its estimated length (the same estimate as the card's). */
  storyboard: Storyboard;
  styleId: string;
  position: number;
  busy: boolean;
  error: string | null;
  /** An edit kept after a 412, put back on the newer storyboard (F3.6 QA). */
  restored?: SceneDraft | null;
  onCancel: () => void;
  onSubmit: (op: SceneOp) => void;
}) {
  const { scene, storyboard, styleId, position, busy, error, restored, onCancel, onSubmit } = props;
  const id = useId();
  const [narration, setNarration] = useState(restored?.narration ?? scene.narration);
  const [type, setType] = useState<SceneType>(restored?.type ?? scene.type);
  const [draft, setDraft] = useState<any>(() => structuredClone(restored?.props ?? scene.props));
  // Each type's draft, so switching back shows what was typed there (switchSceneType).
  const [drafts, setDrafts] = useState<Partial<Record<SceneType, any>>>({});
  const [headlines, setHeadlines] = useState(() => {
    const saved = scene.beats.map((b) => b.headline);
    return restored && restored.headlines.length === saved.length ? restored.headlines : saved;
  });
  const narrationBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    narrationBox.current?.focus();
  }, []);

  const problems = sceneProblems({ narration, type, props: cleanProps(type, draft), beats: headlines.map((h, i) => ({ ...scene.beats[i], headline: h })) });
  const words = wordCount(narration);
  // The card's estimate for these words (QA: the form said ~6s where the card said ~7s).
  const length = useMemo(() => lengthLabel(editedSceneSec(storyboard, scene.id, narration, styleId)), [storyboard, scene.id, narration, styleId]);

  const changeType = (next: SceneType) => {
    // From the saved scene each time (plus what was typed in its own type), not from the last type shown (QA, F3.6).
    const out = switchSceneType({ saved: scene, drafts, current: type, draft, next, narration });
    setDrafts(out.drafts);
    setDraft(out.draft);
    setType(next);
  };

  return (
    <form
      className="flex flex-col gap-4"
      aria-label={`Edit scene ${position}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length) return;
        onSubmit({ kind: "edit", sceneId: scene.id, narration, type, props: cleanProps(type, draft), beats: headlines.map((headline) => ({ headline })) });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-narration`} className="font-mono text-xs text-muted">
          narration
        </label>
        <textarea
          ref={narrationBox}
          id={`${id}-narration`}
          className={cx(inputStyles, "min-h-24 resize-none [field-sizing:content]")}
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
        />
        <p className={cx("font-mono text-xs", words < 8 || words > 40 ? "text-orange" : "text-muted")}>
          {words} words · {length}{words < 8 || words > 40 ? " · 8–40 words usually work best" : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">headline{headlines.length > 1 ? "s" : ""} on screen</span>
        {headlines.map((h, i) => (
          <input
            key={i}
            aria-label={`Headline ${i + 1}`}
            className={inputStyles}
            value={h}
            maxLength={70}
            onChange={(e) => setHeadlines((hs) => hs.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-type`} className="font-mono text-xs text-muted">
          scene type
        </label>
        <select id={`${id}-type`} className={inputStyles} value={type} onChange={(e) => changeType(e.target.value as SceneType)}>
          {SCENE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {type !== scene.type ? <p className="text-xs text-muted">What carried over is filled in; fill in the rest. The preview shows the new type after saving.</p> : null}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
        <legend className="px-1 font-mono text-xs text-muted">on screen · {TYPE_LABEL[type]}</legend>
        <Fields fields={SCENE_FORMS[type]} value={draft} onChange={setDraft} actors={type === "Illustration" ? (draft.actors ?? []) : []} path={`${id}-p`} />
      </fieldset>

      {problems.length ? (
        <ul className="flex flex-col gap-0.5 text-sm text-red" aria-live="polite">
          {problems.slice(0, 6).map((p) => (
            <li key={p.field + p.issue}>
              {problemText(type, p)}
            </li>
          ))}
        </ul>
      ) : null}
      {restored ? (
        <p role="status" className="text-sm text-cyan">
          The storyboard changed (another tab or a regenerate), so your edit wasn&apos;t saved. It&apos;s back in the form: Save to keep it on the
          newer storyboard, or Cancel to see the scene as it is now.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || problems.length > 0} aria-busy={busy} data-scene={scene.id} data-action="save">
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One type's fields, from its SCENE_FORMS entry. */
function Fields({ fields, value, onChange, actors, path }: { fields: FieldSpec[]; value: any; onChange: (v: any) => void; actors: any[]; path: string }) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <>
      {fields.map((f) => {
        const fid = `${path}-${f.key}`;
        const v = value?.[f.key];
        switch (f.kind) {
          case "text":
            return (
              <label key={f.key} htmlFor={fid} className="flex flex-col gap-1 text-xs text-muted">
                <span className="font-mono">
                  {f.label}
                  {f.optional ? " (optional)" : ""}
                </span>
                <input id={fid} className={inputStyles} value={v ?? ""} maxLength={f.max} onChange={(e) => set(f.key, e.target.value)} />
              </label>
            );
          case "number":
            return (
              <label key={f.key} htmlFor={fid} className="flex flex-col gap-1 text-xs text-muted">
                <span className="font-mono">{f.label}</span>
                <input
                  id={fid}
                  type="number"
                  inputMode="decimal"
                  className={inputStyles}
                  value={Number.isFinite(v) ? v : ""}
                  min={f.min}
                  max={f.max}
                  step={f.integer ? 1 : "any"}
                  onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
                />
              </label>
            );
          case "select":
            return (
              <label key={f.key} htmlFor={fid} className="flex flex-col gap-1 text-xs text-muted">
                <span className="font-mono">{f.label}</span>
                <select id={fid} className={inputStyles} value={v ?? ""} onChange={(e) => set(f.key, e.target.value || undefined)}>
                  {f.optional ? <option value="">default</option> : null}
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            );
          case "checkbox":
            return (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} className="size-4 accent-cyan" />
                {f.label}
              </label>
            );
          case "actor": {
            const options = [...actors.map((a: any) => ({ value: a.id, label: a.label || a.kind || a.id })), ...FLOW_EDGES.map((e) => ({ value: e, label: `screen ${e}` }))];
            return (
              <label key={f.key} htmlFor={fid} className="flex flex-col gap-1 text-xs text-muted">
                <span className="font-mono">{f.label}</span>
                <select id={fid} className={inputStyles} value={v ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          case "group":
            return (
              <fieldset key={f.key} className="flex flex-col gap-2 rounded-lg border border-line p-2">
                <legend className="px-1 font-mono text-xs text-muted">{f.label}</legend>
                <Fields fields={f.fields} value={v ?? {}} onChange={(g) => set(f.key, g)} actors={actors} path={fid} />
              </fieldset>
            );
          case "list": {
            const items: any[] = Array.isArray(v) ? v : [];
            return (
              <fieldset key={f.key} className="flex flex-col gap-2">
                <legend className="font-mono text-xs text-muted">
                  {f.label} ({f.min}–{f.max})
                </legend>
                <ol className="flex flex-col gap-2">
                  {items.map((it, i) => (
                    <li key={f.strings ? i : (it?.id ?? i)} className="flex items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        {f.strings ? (
                          <input
                            aria-label={`${f.itemLabel} ${i + 1}`}
                            className={inputStyles}
                            value={it ?? ""}
                            maxLength={(f.item[0] as { max?: number }).max}
                            onChange={(e) => set(f.key, items.map((x, j) => (j === i ? e.target.value : x)))}
                          />
                        ) : (
                          <Fields fields={f.item} value={it} onChange={(n) => set(f.key, items.map((x, j) => (j === i ? n : x)))} actors={actors} path={`${fid}-${i}`} />
                        )}
                      </div>
                      <button
                        type="button"
                        className="mt-1 grid size-7 shrink-0 place-items-center rounded text-muted hover:text-red disabled:opacity-40"
                        aria-label={`Remove ${f.itemLabel} ${i + 1}`}
                        disabled={items.length <= f.min}
                        onClick={() => set(f.key, items.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
                {items.length < f.max ? (
                  <Button type="button" variant="ghost" className="self-start px-2.5 py-1 font-mono text-xs" onClick={() => set(f.key, [...items, newListItem(f, items)])}>
                    + add {f.itemLabel}
                  </Button>
                ) : null}
              </fieldset>
            );
          }
        }
      })}
    </>
  );
}
