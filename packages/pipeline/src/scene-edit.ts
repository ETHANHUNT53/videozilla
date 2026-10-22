/* eslint-disable @typescript-eslint/no-explicit-any -- scene props differ per scene type; each is checked by its own Zod schema. */
import { cueTargetsFor, SCENE_PROPS, SCENE_TYPES, type BeatMeta, type Cue, type Language, type Scene, type SceneType, type Storyboard } from "@videozilla/schema";
import { normalizeToken, similarity, tokenize } from "./text";

/**
 * Manual scene edits (F3.6, PRD F3-FR7): edit a scene (narration, on-screen text, headlines, or its type), delete it, or
 * move it, as one pure step the API and the page share. The page uses it to show what will change before saving (your
 * answer: "ask me each time"); the API uses it to save exactly that. Scene ids stay stable (§13.2); `beat` is kept
 * (chapters reflowed after a move or delete); `themeHints` are never touched. See docs/features/F3.6-scene-edits.md.
 */

// ---------- The form of each scene type (its props, §14.2) ----------

export type FieldSpec =
  | { kind: "text"; key: string; label: string; max: number; optional?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; integer?: boolean }
  | { kind: "select"; key: string; label: string; options: readonly string[]; optional?: boolean }
  | { kind: "checkbox"; key: string; label: string }
  | { kind: "list"; key: string; label: string; min: number; max: number; item: FieldSpec[]; idPrefix?: string; strings?: boolean; itemLabel: string }
  | { kind: "group"; key: string; label: string; fields: FieldSpec[] }
  /** A choice among the scene's own actors (and screen edges): Illustration flows. */
  | { kind: "actor"; key: string; label: string };

const icon: FieldSpec = { kind: "text", key: "icon", label: "icon (Lucide name)", max: 40, optional: true };
const ACCENTS = ["cyan", "orange", "violet", "green"] as const;

export const SCENE_FORMS: Record<SceneType, FieldSpec[]> = {
  TitleHook: [{ kind: "text", key: "headline", label: "headline", max: 60 }, { kind: "text", key: "subline", label: "subline", max: 60, optional: true }, icon],
  KeywordReveal: [{ kind: "list", key: "keywords", label: "keywords", itemLabel: "keyword", min: 1, max: 3, idPrefix: "k", item: [{ kind: "text", key: "text", label: "keyword", max: 32 }] }],
  BulletSteps: [
    { kind: "text", key: "title", label: "title", max: 40, optional: true },
    { kind: "list", key: "items", label: "items", itemLabel: "item", min: 2, max: 4, idPrefix: "i", item: [{ kind: "text", key: "text", label: "item", max: 70 }, icon] },
  ],
  Flowchart: [{ kind: "list", key: "nodes", label: "steps", itemLabel: "step", min: 2, max: 5, idPrefix: "n", item: [{ kind: "text", key: "label", label: "step", max: 32 }, icon] }],
  Comparison: (["left", "right"] as const).map(
    (side): FieldSpec => ({
      kind: "group",
      key: side,
      label: side,
      fields: [
        { kind: "text", key: "title", label: `${side} title`, max: 24 },
        { kind: "list", key: "points", label: `${side} points`, itemLabel: "point", min: 1, max: 3, strings: true, item: [{ kind: "text", key: "text", label: "point", max: 40 }] },
        icon,
      ],
    }),
  ),
  StatCounter: [
    { kind: "number", key: "value", label: "number" },
    { kind: "text", key: "prefix", label: "before the number (e.g. ₹)", max: 4, optional: true },
    { kind: "text", key: "suffix", label: "after the number (e.g. %)", max: 12, optional: true },
    { kind: "text", key: "label", label: "label", max: 60 },
    icon,
  ],
  RecapOutro: [
    { kind: "list", key: "points", label: "points", itemLabel: "point", min: 1, max: 3, idPrefix: "p", item: [{ kind: "text", key: "text", label: "point", max: 50 }] },
    { kind: "text", key: "cta", label: "call to action", max: 50 },
  ],
  Illustration: [
    { kind: "text", key: "title", label: "title", max: 40, optional: true },
    { kind: "checkbox", key: "ground", label: "things stand on the ground" },
    {
      kind: "list",
      key: "actors",
      label: "things in the picture",
      itemLabel: "thing",
      min: 1,
      max: 6,
      idPrefix: "a",
      item: [
        { kind: "text", key: "kind", label: "what (e.g. sun, plant, icon:car)", max: 40 },
        { kind: "text", key: "label", label: "label", max: 28, optional: true },
        { kind: "select", key: "size", label: "size", options: ["s", "m", "l"], optional: true },
      ],
    },
    {
      kind: "list",
      key: "flows",
      label: "arrows / flows",
      itemLabel: "flow",
      min: 0,
      max: 5,
      idPrefix: "f",
      item: [
        { kind: "actor", key: "from", label: "from" },
        { kind: "actor", key: "to", label: "to" },
        { kind: "select", key: "style", label: "style", options: ["particles", "beam", "arrow"], optional: true },
        { kind: "text", key: "label", label: "label", max: 24, optional: true },
      ],
    },
  ],
  UnitGrid: [
    { kind: "number", key: "total", label: "how many units", min: 4, max: 600, integer: true },
    { kind: "select", key: "unit", label: "unit", options: ["dot", "person", "car"], optional: true },
    { kind: "text", key: "label", label: "counter word", max: 20, optional: true },
    {
      kind: "list",
      key: "states",
      label: "states",
      itemLabel: "state",
      min: 1,
      max: 4,
      idPrefix: "g",
      item: [
        { kind: "number", key: "active", label: "lit units", min: 0, integer: true },
        { kind: "select", key: "color", label: "colour", options: ACCENTS, optional: true },
        { kind: "text", key: "note", label: "note", max: 40, optional: true },
      ],
    },
  ],
};

/** Screen edges an Illustration flow may start or end at. */
export const FLOW_EDGES = ["left", "right", "top", "bottom"] as const;

/** A new list item for `spec` (ids continue the list's numbering). */
export function newListItem(spec: Extract<FieldSpec, { kind: "list" }>, existing: any[]): any {
  if (spec.strings) return "";
  const used = new Set(existing.map((x) => x?.id));
  let n = existing.length + 1;
  while (used.has(`${spec.idPrefix}${n}`)) n++;
  const item: any = { id: `${spec.idPrefix}${n}` };
  for (const f of spec.item) if (f.kind === "text" && !f.optional) item[f.key] = "";
  if (spec.key === "states") item.active = 0;
  if (spec.key === "flows") Object.assign(item, { from: "left", to: "right", style: "arrow" });
  return item;
}

/** Drops empty optional text fields and trims texts, so the schema sees what the user means. */
export function cleanProps(type: SceneType, props: any): any {
  const clean = (fields: FieldSpec[], obj: any): any => {
    const out: any = { ...obj };
    for (const f of fields) {
      const v = out[f.key];
      if (f.kind === "text") {
        const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v;
        if ((t === "" || t === undefined) && f.optional) delete out[f.key];
        else out[f.key] = t;
      } else if (f.kind === "select" && f.optional && (v === "" || v === undefined)) delete out[f.key];
      else if (f.kind === "list" && Array.isArray(v)) out[f.key] = f.strings ? v.map((s: any) => String(s ?? "").replace(/\s+/g, " ").trim()) : v.map((it: any) => clean(f.item, it));
      else if (f.kind === "group" && v && typeof v === "object") out[f.key] = clean(f.fields, v);
    }
    return out;
  };
  return clean(SCENE_FORMS[type], props ?? {});
}

// ---------- Changing a scene's type (by hand, no AI) ----------

/** Every piece of on-screen text in a scene's props, in reading order. */
export function propTexts(type: SceneType, props: any): string[] {
  const out: string[] = [];
  const walk = (fields: FieldSpec[], obj: any) => {
    for (const f of fields) {
      const v = obj?.[f.key];
      if (f.kind === "text" && f.key !== "icon" && f.key !== "kind" && typeof v === "string" && v.trim()) out.push(v.trim());
      else if (f.kind === "list" && Array.isArray(v)) {
        for (const it of v) {
          if (!f.strings) walk(f.item, it);
          else if (typeof it === "string" && it.trim()) out.push(it.trim());
        }
      }
      else if (f.kind === "group") walk(f.fields, v);
    }
  };
  walk(SCENE_FORMS[type], props);
  if (type === "StatCounter" && typeof props?.value === "number") out.unshift(`${props.prefix ?? ""}${props.value}${props.suffix ?? ""}`.trim());
  return out;
}

const cut = (s: string | undefined, max: number) => (s ? Array.from(s).slice(0, max).join("") : "");

/**
 * The props of `to`, filled from what the scene already shows (your answer: pre-filled where content carries over,
 * empty where nothing maps). The result may not pass the schema yet; the page keeps Save off until it does.
 */
export function convertProps(from: SceneType, props: any, to: SceneType, narration = ""): any {
  if (from === to) return structuredClone(props);
  const pool = propTexts(from, props);
  const list = (n: number, max: number, prefix: string, key = "text", min = 1) => {
    const items = pool.slice(0, n).map((t, i) => ({ id: `${prefix}${i + 1}`, [key]: cut(t, max) }));
    while (items.length < min) items.push({ id: `${prefix}${items.length + 1}`, [key]: "" });
    return items;
  };
  switch (to) {
    case "TitleHook":
      return { headline: cut(pool[0], 60), ...(pool[1] ? { subline: cut(pool[1], 60) } : {}) };
    case "KeywordReveal":
      return { keywords: list(3, 32, "k") };
    case "BulletSteps":
      return pool.length > 2 ? { title: cut(pool[0], 40), items: list(5, 70, "i", "text", 2).slice(1, 5) } : { items: list(4, 70, "i", "text", 2) };
    case "Flowchart":
      return { nodes: list(5, 32, "n", "label", 2) };
    case "Comparison":
      return {
        left: { title: cut(pool[0], 24), points: [cut(pool[2], 40)] },
        right: { title: cut(pool[1], 24), points: [cut(pool[3], 40)] },
      };
    case "StatCounter": {
      const source = [...pool, narration].join(" ");
      const m = source.match(/-?\d[\d,]*(?:\.\d+)?/);
      const label = pool.find((t) => !/^\s*[-₹$]?\d/.test(t)) ?? "";
      return { value: m ? Number(m[0].replace(/,/g, "")) : 0, label: cut(label, 60) };
    }
    case "RecapOutro":
      return { points: list(3, 50, "p"), cta: "" };
    case "Illustration":
      return { actors: autoLayout(pool.slice(0, 3).map((t, i) => ({ id: `a${i + 1}`, kind: "", label: cut(t, 28) }))).concat(pool.length ? [] : [{ id: "a1", kind: "", x: 50, y: 50 }]), flows: [] };
    case "UnitGrid":
      return { total: 100, unit: "dot", ...(pool[0] ? { label: cut(pool[0], 20) } : {}), states: [{ id: "g1", active: 50, color: "cyan" }] };
  }
}

/** Positions for Illustration actors that have none: spread across the picture. */
export function autoLayout(actors: any[]): any[] {
  const n = actors.length;
  return actors.map((a, i) => (typeof a.x === "number" && typeof a.y === "number" ? a : { ...a, x: Math.round(((i + 1) * 100) / (n + 1)), y: 55 }));
}

// ---------- Validation ----------

export interface EditProblem {
  field: string;
  issue: string;
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const NARRATION_MAX_WORDS = 80;

/** What's wrong with an edited scene (field paths like `props.items[2].text`), empty when it can be saved. */
export function sceneProblems(scene: Pick<Scene, "narration" | "type" | "props" | "beats">): EditProblem[] {
  const problems: EditProblem[] = [];
  const words = tokenize(scene.narration).length;
  if (!scene.narration.trim()) problems.push({ field: "narration", issue: "is empty" });
  else if (words > NARRATION_MAX_WORDS) problems.push({ field: "narration", issue: `is ${words} words; at most ${NARRATION_MAX_WORDS}` });
  if (CONTROL.test(scene.narration)) problems.push({ field: "narration", issue: "has invisible control characters" });
  if (!(SCENE_TYPES as string[]).includes(scene.type)) {
    problems.push({ field: "type", issue: `isn't a scene type (${SCENE_TYPES.join(", ")})` });
    return problems;
  }
  const parsed = SCENE_PROPS[scene.type].safeParse(cleanProps(scene.type, scene.props));
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) {
      const path = i.path.reduce<string>((p, k) => (typeof k === "number" ? `${p}[${k}]` : `${p}.${String(k)}`), "props");
      problems.push({ field: path, issue: i.code === "too_small" && /string/.test(i.message) ? "is empty" : i.message });
    }
  }
  if (scene.type === "Illustration") {
    const ids = new Set(((scene.props as any)?.actors ?? []).map((a: any) => a.id));
    ((scene.props as any)?.flows ?? []).forEach((f: any, i: number) => {
      for (const end of ["from", "to"]) if (!ids.has(f[end]) && !(FLOW_EDGES as readonly string[]).includes(f[end])) problems.push({ field: `props.flows[${i}].${end}`, issue: "isn't one of the things in the picture" });
    });
  }
  (scene.beats ?? []).forEach((b, i) => {
    if (!b.headline?.trim()) problems.push({ field: `beats[${i}].headline`, issue: "is empty" });
    else if (Array.from(b.headline).length > 70) problems.push({ field: `beats[${i}].headline`, issue: "is longer than 70 characters" });
  });
  return problems;
}

// ---------- Cues (sync points) after an edit ----------

function wordsOf(text: string): string[] {
  return tokenize(text).map(normalizeToken).filter(Boolean);
}

/** Where `anchor` occurs in `narration`: exactly (in order), or the closest single word (≥ 0.8), else null. */
export function findAnchor(anchor: string, narration: string): { anchor: string; exact: boolean } | null {
  const a = wordsOf(anchor);
  const raw = tokenize(narration);
  const w = raw.map(normalizeToken);
  if (!a.length || !w.length) return null;
  const bare = (word: string) => word.replace(/[।॥.,!?;:'"“”‘’()]/g, "");
  for (let i = 0; i + a.length <= w.length; i++) if (a.every((t, k) => w[i + k] === t)) return { anchor: raw.slice(i, i + a.length).map(bare).join(" "), exact: true };
  let best = { i: -1, score: 0 };
  w.forEach((t, i) => {
    const s = Math.max(...a.map((x) => similarity(t, x)));
    if (s > best.score) best = { i, score: s };
  });
  return best.score >= 0.8 ? { anchor: bare(raw[best.i]), exact: false } : null;
}

/** The words an element shows (its label), to anchor a new cue on when the narration says them. */
function elementText(type: SceneType, props: any, target: string): string {
  if (!props) return "";
  if (typeof props[target] === "string") return props[target];
  if (target === "value" && typeof props.value === "number") return String(props.value);
  if (target === "left" || target === "right") return props[target]?.title ?? "";
  for (const key of ["keywords", "items", "nodes", "points", "actors", "flows", "states"]) {
    const hit = (props[key] ?? []).find((x: any) => x?.id === target);
    if (hit) return hit.text ?? hit.label ?? hit.note ?? (typeof hit.kind === "string" && !hit.kind.startsWith("icon:") ? hit.kind : "") ?? "";
  }
  return "";
}

export interface CueReport {
  /** Cues (and headline anchors) that will appear at a different word, or spread evenly instead. */
  retimed: number;
}

/**
 * The scene's cues rebuilt for its (maybe new) elements and narration: a cue still found in the narration is kept; one
 * whose words are gone is re-anchored to the closest word, else to the element's own words if the narration says
 * them, else dropped (the build spreads it evenly). Elements without a cue get one when the narration says their words.
 */
export function rebuildCues(before: Pick<Scene, "type" | "props" | "cues" | "narration" | "beats">, after: Pick<Scene, "type" | "props" | "narration" | "beats">): { cues: Cue[]; beats: Scene["beats"]; report: CueReport } {
  let retimed = 0;
  const targets = cueTargetsFor(after.type, after.props);
  const cues: Cue[] = [];
  for (const target of targets) {
    const old = before.type === after.type ? before.cues.find((c) => c.target === target) : undefined;
    if (old) {
      const found = findAnchor(old.anchor, after.narration);
      // Still said, word for word: the same moment.
      if (found?.exact && wordsOf(found.anchor).join(" ") === wordsOf(old.anchor).join(" ")) {
        cues.push(old);
        continue;
      }
      const own = findAnchor(elementText(after.type, after.props, target), after.narration);
      const next = found ?? own;
      retimed++;
      if (next) cues.push({ target, anchor: next.anchor });
      continue;
    }
    const own = elementText(after.type, after.props, target);
    const found = own ? findAnchor(own, after.narration) : null;
    if (found?.exact) {
      cues.push({ target, anchor: found.anchor });
      if (before.type !== after.type) retimed++;
    } else if (before.type !== after.type && before.cues.length) retimed++;
  }
  // Old cues for elements that are gone (another type, a removed item): their visuals aren't there any more.
  if (before.type === after.type) retimed += before.cues.filter((c) => !targets.includes(c.target)).length;
  const beats = (after.beats ?? []).map((b, i) => {
    if (i === 0 || !b.anchor) return b;
    const found = findAnchor(b.anchor, after.narration);
    if (found?.exact) return b;
    retimed++;
    const rest = { ...b };
    delete rest.anchor;
    delete rest.occurrence;
    return found ? { ...rest, anchor: found.anchor } : rest;
  });
  return { cues, beats, report: { retimed } };
}

// ---------- Chapters and diagram steps after a move or delete ----------

export interface ChapterChange {
  sceneId: string;
  from: number | null;
  to: number | null;
}

/**
 * Chapters renumbered 1, 2, 3… by runs in the new order (a chapter left empty disappears), and diagram steps per
 * diagram renumbered in order. `moved`: that scene joins the chapter of the scene now above it (or below, at the top),
 * so chapters stay together (your answer, F3.6). Scenes without a chapter (a hook, a recap) keep having none.
 */
export function reflowBeats(scenes: Scene[], moved?: string): Scene[] {
  const out = scenes.map((s) => ({ ...s, beat: { ...s.beat, ...(s.beat.chapter ? { chapter: { ...s.beat.chapter } } : {}) } as BeatMeta }));
  if (moved) {
    const i = out.findIndex((s) => s.id === moved);
    const me = out[i];
    if (me?.beat.chapter) {
      const neighbour = out[i - 1]?.beat.chapter ?? out[i + 1]?.beat.chapter;
      if (neighbour) me.beat.chapter = { ...neighbour };
    }
  }
  let index = 0;
  let key: string | null = null;
  for (const s of out) {
    const c = s.beat.chapter;
    if (!c) continue;
    const k = `${c.index}|${c.headline}`;
    if (k !== key) {
      index++;
      key = k;
    }
    s.beat.chapter = { ...c, index };
  }
  const steps = new Map<string, number>();
  for (const s of out) {
    const d = s.beat.diagram;
    if (!d) continue;
    const step = (steps.get(d.id) ?? 0) + 1;
    steps.set(d.id, step);
    s.beat.diagram = { id: d.id, step };
  }
  return out;
}

// ---------- One edit, delete or move ----------

export type SceneOp =
  | { kind: "edit"; sceneId: string; narration?: string; type?: SceneType; props?: unknown; beats?: { headline: string }[] }
  | { kind: "delete"; sceneId: string }
  | { kind: "move"; sceneId: string; afterSceneId: string | null };

export interface SceneOpChanges {
  /** Per scene (by id): how many cues / headline anchors are re-timed. */
  retimed: { sceneId: string; count: number }[];
  chapterMoves: ChapterChange[];
  /** Other chapters' numbers changed. */
  renumbered: boolean;
  /** Non-blocking: e.g. the video will start without a hook. */
  warnings: string[];
}

export type SceneOpResult =
  | { ok: true; storyboard: Storyboard; changes: SceneOpChanges; changedSceneIds: string[]; summary: string; noop: boolean }
  | { ok: false; status: "not_found" | "invalid"; problems: EditProblem[] };

const position = (sb: Storyboard, id: string) => sb.scenes.findIndex((s) => s.id === id) + 1;

function chapterDiff(before: Scene[], after: Scene[], skip?: string): { moves: ChapterChange[]; renumbered: boolean } {
  const was = new Map(before.map((s) => [s.id, s.beat.chapter?.index ?? null]));
  const moves: ChapterChange[] = [];
  let renumbered = false;
  for (const s of after) {
    const from = was.get(s.id) ?? null;
    const to = s.beat.chapter?.index ?? null;
    if (from === to) continue;
    const headlineBefore = before.find((b) => b.id === s.id)?.beat.chapter?.headline;
    if (s.id === skip || headlineBefore !== s.beat.chapter?.headline) moves.push({ sceneId: s.id, from, to });
    else renumbered = true;
  }
  return { moves, renumbered };
}

export function applySceneOp(storyboard: Storyboard, op: SceneOp): SceneOpResult {
  const index = storyboard.scenes.findIndex((s) => s.id === op.sceneId);
  if (index < 0) return { ok: false, status: "not_found", problems: [{ field: "sceneId", issue: "no such scene" }] };
  const scene = storyboard.scenes[index];
  const n = index + 1;

  if (op.kind === "edit") {
    const type = op.type ?? scene.type;
    const props = op.props !== undefined ? op.props : type === scene.type ? scene.props : convertProps(scene.type, scene.props, type, op.narration ?? scene.narration);
    const narration = (op.narration ?? scene.narration).replace(/\s+/g, " ").trim();
    const beatsIn = op.beats
      ? op.beats.map((b, i) => ({ ...(scene.beats[i] ?? { accent: "cyan" }), headline: String(b.headline ?? "").replace(/\s+/g, " ").trim() }))
      : scene.beats;
    const draft = { narration, type, props: (SCENE_TYPES as string[]).includes(type) ? cleanProps(type, props) : props, beats: beatsIn };
    const problems = sceneProblems(draft);
    if (op.beats && (op.beats.length < 1 || op.beats.length > 3)) problems.push({ field: "beats", issue: "must be 1 to 3 headlines" });
    if (problems.length) return { ok: false, status: "invalid", problems };
    // New Illustration actors get a place in the picture; then the schema's own output (defaults, key order).
    const finalProps = SCENE_PROPS[type].parse(type === "Illustration" ? { ...draft.props, actors: autoLayout(draft.props.actors ?? []) } : draft.props);
    const { cues, beats, report } = rebuildCues(scene, { type, props: finalProps, narration, beats: draft.beats });
    const next: Scene = { ...scene, narration, type, props: finalProps, cues, beats };
    const noop = JSON.stringify(next) === JSON.stringify(scene);
    return {
      ok: true,
      storyboard: { ...storyboard, scenes: storyboard.scenes.map((s) => (s.id === scene.id ? next : s)) },
      changes: { retimed: report.retimed ? [{ sceneId: scene.id, count: report.retimed }] : [], chapterMoves: [], renumbered: false, warnings: [] },
      changedSceneIds: [scene.id],
      summary: type !== scene.type ? `Changed scene ${n} to ${type}` : `Edited scene ${n}`,
      noop,
    };
  }

  if (op.kind === "delete") {
    if (storyboard.scenes.length <= 1) return { ok: false, status: "invalid", problems: [{ field: "sceneId", issue: "the last scene can't be deleted" }] };
    const left = storyboard.scenes.filter((s) => s.id !== scene.id);
    const scenes = reflowBeats(left);
    const { moves, renumbered } = chapterDiff(left, scenes);
    const warnings: string[] = [];
    if (index === 0 && scene.role === "hook") warnings.push("The video will start without its hook.");
    if (index === storyboard.scenes.length - 1 && (scene.role === "recap" || scene.role === "outro")) warnings.push("The video will end without its recap.");
    return {
      ok: true,
      storyboard: { ...storyboard, scenes },
      changes: { retimed: [], chapterMoves: moves, renumbered: renumbered || moves.length > 0, warnings },
      changedSceneIds: [],
      summary: `Deleted scene ${n}`,
      noop: false,
    };
  }

  // Move: after `afterSceneId` (null = to the top).
  const rest = storyboard.scenes.filter((s) => s.id !== scene.id);
  let at = 0;
  if (op.afterSceneId !== null) {
    const after = rest.findIndex((s) => s.id === op.afterSceneId);
    if (after < 0) return { ok: false, status: "invalid", problems: [{ field: "afterSceneId", issue: "no such scene" }] };
    at = after + 1;
  }
  const order = [...rest.slice(0, at), scene, ...rest.slice(at)];
  if (order.every((s, i) => s.id === storyboard.scenes[i].id)) {
    return { ok: true, storyboard, changes: { retimed: [], chapterMoves: [], renumbered: false, warnings: [] }, changedSceneIds: [], summary: "", noop: true };
  }
  const scenes = reflowBeats(order, scene.id);
  const { moves, renumbered } = chapterDiff(storyboard.scenes, scenes, scene.id);
  const changedSceneIds = scenes.filter((s, i) => storyboard.scenes[i]?.id !== s.id).map((s) => s.id);
  return {
    ok: true,
    storyboard: { ...storyboard, scenes },
    changes: { retimed: [], chapterMoves: moves, renumbered, warnings: [] },
    changedSceneIds,
    summary: `Moved scene ${n} to position ${at + 1}`,
    noop: false,
  };
}

/** Whether the page should confirm before saving (your answer: when timing or chapters change, or with a warning). */
export function needsConfirm(c: SceneOpChanges): boolean {
  return c.retimed.length > 0 || c.chapterMoves.length > 0 || c.renumbered || c.warnings.length > 0;
}

/** The confirm's lines, e.g. "2 visuals re-timed in scene 3", "Scene 5 moves from chapter 2 to chapter 1". */
export function describeChanges(c: SceneOpChanges, after: Storyboard): string[] {
  const lines: string[] = [...c.warnings];
  for (const r of c.retimed) lines.push(`${r.count} ${r.count === 1 ? "visual or headline" : "visuals or headlines"} in scene ${position(after, r.sceneId)} will appear at a different moment (re-timed to the narration).`);
  for (const m of c.chapterMoves) {
    const at = position(after, m.sceneId);
    lines.push(m.from === null ? `Scene ${at} joins chapter ${m.to}.` : m.to === null ? `Scene ${at} leaves chapter ${m.from}.` : `Scene ${at} moves from chapter ${m.from} to chapter ${m.to}.`);
  }
  if (c.renumbered) lines.push("Chapters are renumbered in the new order.");
  return lines;
}

// ---------- Length, after a manual change ----------

const WPM: Record<Language, number> = { en: 150, hi: 140 };

/** The version's report after a manual change (no repairs; the warnings that matter on the screen). */
export function measureStoryboard(sb: Storyboard): { repairs: string[]; warnings: string[]; wordCount: number; estimatedDurationSec: number } {
  const wordCount = sb.scenes.reduce((n, s) => n + tokenize(s.narration).length, 0);
  const estimatedDurationSec = Math.round((wordCount / WPM[sb.language]) * 60 + sb.scenes.length * 0.5);
  const warnings: string[] = [];
  sb.scenes.forEach((s, i) => {
    const wc = tokenize(s.narration).length;
    if (wc < 8 || wc > 40) warnings.push(`scene ${i + 1}: ${wc} words of narration (target 8-40)`);
  });
  return { repairs: [], warnings, wordCount, estimatedDurationSec };
}
