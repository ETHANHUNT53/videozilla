"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- scene props differ per scene type; the form is driven by SCENE_FORMS. */
import { cleanProps, convertProps, FLOW_EDGES, newListItem, SCENE_FORMS, sceneProblems, type FieldSpec, type SceneOp } from "@videozilla/pipeline";
import { SCENE_TYPES, type Scene, type SceneType } from "@videozilla/schema";
import { useEffect, useId, useRef, useState } from "react";
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

export function SceneEditForm(props: { scene: Scene; position: number; busy: boolean; error: string | null; onCancel: () => void; onSubmit: (op: SceneOp) => void }) {
  const { scene, position, busy, error, onCancel, onSubmit } = props;
  const id = useId();
  const [narration, setNarration] = useState(scene.narration);
  const [type, setType] = useState<SceneType>(scene.type);
  const [draft, setDraft] = useState<any>(() => structuredClone(scene.props));
  const [headlines, setHeadlines] = useState(scene.beats.map((b) => b.headline));
  const narrationBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    narrationBox.current?.focus();
  }, []);

  const problems = sceneProblems({ narration, type, props: cleanProps(type, draft), beats: headlines.map((h, i) => ({ ...scene.beats[i], headline: h })) });
  const words = wordCount(narration);
  const seconds = Math.round((words / 150) * 60);

  const changeType = (next: SceneType) => {
    // Convert from what's on screen now (the draft), so edits made before switching carry over too.
    setDraft(convertProps(type, cleanProps(type, draft), next, narration));
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
          {words} words · ~{seconds}s{words < 8 || words > 40 ? " · 8–40 words usually work best" : ""}
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
              {fieldName(p.field)} {p.issue}.
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || problems.length > 0} aria-busy={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "props.items[2].text" → "Item 3:" (what the person sees in the form). */
function fieldName(field: string): string {
  const m = field.match(/^props\.(\w+)(?:\[(\d+)\])?(?:\.(\w+))?/);
  if (field === "narration") return "Narration";
  if (field.startsWith("beats")) return `Headline ${Number(field.match(/\[(\d+)\]/)?.[1] ?? 0) + 1}`;
  if (!m) return "This";
  const [, key, i, sub] = m;
  return `${key[0].toUpperCase()}${key.slice(1)}${i !== undefined ? ` ${Number(i) + 1}` : ""}${sub ? ` (${sub})` : ""}:`;
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
