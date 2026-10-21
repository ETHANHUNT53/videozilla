/* eslint-disable @typescript-eslint/no-explicit-any -- repairs untrusted model output of any shape before it is validated; typing these is a later refactor. */
import {
  ACCENT_NAMES,
  type BeatMeta,
  MOODS,
  type Mood,
  SCENE_PROPS,
  SCENE_TYPES,
  cueTargetsFor,
  type Language,
  type RawStoryboard,
  type Scene,
  type SceneType,
  type Storyboard,
  WORD_BUDGET,
} from "@videozilla/schema";
import { normalizeToken, tokenize } from "./text";

export interface ValidationReport {
  repairs: string[];
  warnings: string[];
  wordCount: number;
  estimatedDurationSec: number;
}

const WPM: Record<Language, number> = { en: 150, hi: 140 };

const MAX_ITEMS: Record<string, number> = { keywords: 3, items: 4, nodes: 5, points: 3, actors: 6, flows: 5 };
const EDGES = new Set(["left", "right", "top", "bottom"]);

/** Keeps illustrated objects inside the frame and removes flows that point at nothing. */
function fixIllustration(p: any, repairs: string[], sceneNo: number): any {
  const minY = p.title ? 24 : 10;
  for (const a of p.actors ?? []) {
    const x = Math.min(90, Math.max(10, Number(a.x) || 50));
    const y = Math.min(88, Math.max(minY, Number(a.y) || 50));
    if (x !== a.x || y !== a.y) repairs.push(`scene ${sceneNo}: moved "${a.id}" inside the frame`);
    a.x = x;
    a.y = y;
    if (a.size && !["s", "m", "l"].includes(a.size)) a.size = "m";
  }
  const ids = new Set((p.actors ?? []).map((a: any) => a.id));
  const known = (ref: unknown) => typeof ref === "string" && (EDGES.has(ref) || ids.has(ref.split(".")[0]));
  const flows = (p.flows ?? []).filter((f: any) => known(f.from) && known(f.to) && !(EDGES.has(f.from) && EDGES.has(f.to)));
  if (flows.length !== (p.flows ?? []).length) repairs.push(`scene ${sceneNo}: dropped flows that referenced unknown objects`);
  p.flows = flows;
  return p;
}

/** Clamp list lengths and fill missing ids so slightly-off LLM output still renders. */
function coerceProps(type: SceneType, props: any, repairs: string[], sceneNo: number): any {
  const p = structuredClone(props ?? {});
  for (const [key, max] of Object.entries(MAX_ITEMS)) {
    if (Array.isArray(p[key])) {
      if (p[key].length > max) {
        repairs.push(`scene ${sceneNo}: trimmed ${key} from ${p[key].length} to ${max}`);
        p[key] = p[key].slice(0, max);
      }
      p[key] = p[key].map((item: any, i: number) => {
        if (typeof item === "string" && key !== "points") return { id: `${key[0]}${i + 1}`, text: item, label: item };
        if (item && typeof item === "object" && !item.id && key !== "points") return { ...item, id: `${key[0]}${i + 1}` };
        if (type === "RecapOutro" && key === "points" && typeof item === "string") return { id: `p${i + 1}`, text: item };
        return item;
      });
    }
  }
  if (type === "Comparison") {
    for (const side of ["left", "right"]) {
      if (p[side]?.points?.length > 3) {
        repairs.push(`scene ${sceneNo}: trimmed ${side} points to 3`);
        p[side].points = p[side].points.slice(0, 3);
      }
    }
  }
  if (type === "Illustration") fixIllustration(p, repairs, sceneNo);
  if (type === "UnitGrid") {
    p.total = Math.min(600, Math.max(4, Math.round(Number(p.total) || 100)));
    p.states = (p.states ?? []).slice(0, 4).map((s: any, i: number) => ({
      ...s,
      id: s.id ?? `g${i + 1}`,
      active: Math.min(p.total, Math.max(0, Math.round(Number(s.active) || 0))),
    }));
    if (p.unit && !["dot", "car", "person"].includes(p.unit)) p.unit = "dot";
  }
  if (type === "StatCounter" && typeof p.value === "string") {
    const n = Number(String(p.value).replace(/[^0-9.\-]/g, ""));
    if (!Number.isNaN(n)) {
      repairs.push(`scene ${sceneNo}: converted StatCounter value "${p.value}" to number`);
      p.value = n;
    }
  }
  return p;
}

/** Last-resort fallback: show the first few words of the narration as keywords. */
function fallbackScene(narration: string): { type: SceneType; props: any } {
  const words = narration.split(/\s+/).filter(Boolean);
  return { type: "KeywordReveal", props: { keywords: [{ id: "k1", text: words.slice(0, 4).join(" ") }] } };
}

/** Scene count the PRD accepts per length (F3 structure rules); the prompt aims for 7–9 / 10–13 inside it. */
export const SCENE_RANGE: Record<60 | 90, [number, number]> = { 60: [6, 12], 90: [8, 16] };
const MAX_CHAPTERS = 5;
const MAX_DIAGRAMS = 2;
const MAX_DIAGRAM_STEPS = 8;
const MAX_HASHTAGS = 15;
const MIN_HASHTAGS = 5;
const MAX_CAPTION = 2200;
const MAX_TITLE = 70;

const DEFAULT_MOOD: Record<Scene["role"], Mood> = { hook: "curious", explain: "explain", example: "explain", recap: "recap", outro: "recap" };
const isBody = (role: Scene["role"]) => role === "explain" || role === "example";
const isMood = (m: unknown): m is Mood => (MOODS as readonly unknown[]).includes(m);

/** Cuts text to `max` characters at a word boundary (on-screen labels, never narration). */
function cutText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

/** A short lowercase slug for a diagram id ("Main Diagram" → "main-diagram"); "main" when nothing is left. */
function slug(id: string): string {
  const s = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return s || "main";
}

type RawBeat = RawStoryboard["scenes"][number]["beat"];

/**
 * Builds every scene's `beat` (PRD §13.3) from what the model wrote, repairing instead of failing:
 * - mood: unknown → from the role (silently when missing);
 * - chapters: only body scenes (explain / example) have one; a body scene without one stays in the chapter before it;
 *   numbered 1, 2, 3… in scene order; at most 5 (later ones merged into the 5th); a chapter keeps the first headline
 *   it was given (else the scene's section). No chapters at all → one per run of scenes with the same section;
 * - diagram: id made a slug, at most 2 diagrams, steps renumbered 1, 2, 3… per diagram in scene order (at most 8).
 */
function buildBeats(scenes: { role: Scene["role"]; section: string; raw: RawBeat }[], repairs: string[], warnings: string[]): BeatMeta[] {
  const beats: BeatMeta[] = scenes.map((s, i) => {
    const mood = s.raw?.mood;
    if (mood !== undefined && !isMood(mood)) repairs.push(`scene ${i + 1}: unknown mood "${mood}", used "${DEFAULT_MOOD[s.role]}"`);
    return { mood: isMood(mood) ? mood : DEFAULT_MOOD[s.role] };
  });

  // Chapters.
  const given = (i: number) => {
    const c = scenes[i].raw?.chapter;
    return c && (c.index !== undefined || c.headline?.trim()) ? c : undefined;
  };
  const anyChapter = scenes.some((s, i) => isBody(s.role) && given(i));
  if (!anyChapter && scenes.some((s) => isBody(s.role))) warnings.push("no chapters from the model; grouped the scenes by section");
  let index = 0;
  let key: string | null = null;
  let current: NonNullable<BeatMeta["chapter"]> | null = null;
  let renumbered = false;
  scenes.forEach((s, i) => {
    const c = given(i);
    if (!isBody(s.role)) {
      if (c) repairs.push(`scene ${i + 1}: removed the chapter from a ${s.role} scene`);
      return;
    }
    const sceneKey = !anyChapter ? `s:${s.section.toLowerCase()}` : !c ? null : c.index !== undefined ? `i:${c.index}` : `h:${c.headline!.trim().toLowerCase()}`;
    if (current === null || (sceneKey !== null && sceneKey !== key)) {
      if (index < MAX_CHAPTERS) {
        index++;
        const headline = cutText(c?.headline?.trim() || s.section || `Part ${index}`, 40);
        const subhead = c?.subhead?.trim() ? cutText(c.subhead, 60) : undefined;
        current = { index, headline, ...(subhead ? { subhead } : {}) };
      } else {
        repairs.push(`scene ${i + 1}: more than ${MAX_CHAPTERS} chapters, merged into chapter ${MAX_CHAPTERS}`);
      }
      key = sceneKey;
    }
    if (c?.index !== undefined && c.index !== current!.index) renumbered = true;
    beats[i].chapter = { ...current! };
  });
  if (renumbered) repairs.push("renumbered the chapters 1, 2, 3… in scene order");

  // Diagrams.
  const ids: string[] = [];
  const steps = new Map<string, number>();
  let restepped = false;
  scenes.forEach((s, i) => {
    const d = s.raw?.diagram;
    if (!d || (d.id === undefined && d.step === undefined)) return;
    const id = slug(d.id ?? "main");
    if (!ids.includes(id)) {
      if (ids.length >= MAX_DIAGRAMS) {
        repairs.push(`scene ${i + 1}: dropped diagram "${id}" (at most ${MAX_DIAGRAMS} per video)`);
        return;
      }
      ids.push(id);
    }
    const step = (steps.get(id) ?? 0) + 1;
    if (step > MAX_DIAGRAM_STEPS) {
      repairs.push(`scene ${i + 1}: dropped step ${step} of diagram "${id}" (at most ${MAX_DIAGRAM_STEPS})`);
      return;
    }
    steps.set(id, step);
    if (d.step !== step) restepped = true;
    beats[i].diagram = { id, step };
  });
  if (restepped) repairs.push("renumbered the diagram steps 1, 2, 3… in scene order");
  return beats;
}

/** Hashtags as Instagram wants them: "#word", no spaces, no duplicates, at most 15. */
function cleanHashtags(tags: string[], repairs: string[], warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = `#${String(t).replace(/[\s#]+/g, "")}`;
    if (tag.length < 2 || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  if (out.length > MAX_HASHTAGS) {
    repairs.push(`kept the first ${MAX_HASHTAGS} of ${out.length} hashtags`);
    out.length = MAX_HASHTAGS;
  }
  if (out.length < MIN_HASHTAGS) warnings.push(`only ${out.length} hashtags (aim for ${MIN_HASHTAGS}-${MAX_HASHTAGS})`);
  return out;
}

/** Whether a script of `wordCount` words is more than 15 % outside the word budget (PRD §13.4 step 5). */
export function lengthStatus(wordCount: number, language: Language, targetDurationSec: 60 | 90): "short" | "long" | "ok" {
  const [minW, maxW] = WORD_BUDGET[language][targetDurationSec];
  if (wordCount < minW * 0.85) return "short";
  if (wordCount > maxW * 1.15) return "long";
  return "ok";
}

function anchorInNarration(anchor: string, narration: string): boolean {
  const n = tokenize(narration).map(normalizeToken).join(" ");
  const a = tokenize(anchor).map(normalizeToken).join(" ");
  return a.length > 0 && n.includes(a);
}

export function validateStoryboard(
  raw: RawStoryboard,
  language: Language,
  targetDurationSec: 60 | 90,
): { storyboard: Storyboard; report: ValidationReport } {
  const repairs: string[] = [];
  const warnings: string[] = [];

  const scenes: Scene[] = raw.scenes.map((s, idx) => {
    const sceneNo = idx + 1;
    let type = s.type as SceneType;
    let props: any = s.props;

    if (!SCENE_TYPES.includes(type)) {
      repairs.push(`scene ${sceneNo}: unknown type "${s.type}", replaced with KeywordReveal`);
      ({ type, props } = fallbackScene(s.narration));
    } else {
      props = coerceProps(type, props, repairs, sceneNo);
      const parsed = SCENE_PROPS[type].safeParse(props);
      if (parsed.success) {
        props = parsed.data;
      } else {
        const why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
        repairs.push(`scene ${sceneNo}: invalid ${type} props (${why}), replaced with KeywordReveal`);
        ({ type, props } = fallbackScene(s.narration));
      }
    }

    const targets = new Set(cueTargetsFor(type, props));
    const cues = s.cues.filter((c) => {
      if (!targets.has(c.target)) {
        repairs.push(`scene ${sceneNo}: dropped cue for unknown target "${c.target}"`);
        return false;
      }
      if (!anchorInNarration(c.anchor, s.narration)) {
        warnings.push(`scene ${sceneNo}: cue anchor "${c.anchor}" not found verbatim in narration (will fuzzy-match)`);
      }
      return true;
    });

    const wc = tokenize(s.narration).length;
    if (wc < 8 || wc > 40) warnings.push(`scene ${sceneNo}: ${wc} words of narration (target 8-40)`);

    // Headline beats: keep up to 3, default the accent, and fall back to a headline from the scene itself.
    let beats = (s.beats ?? []).slice(0, 3).map((b) => ({
      ...b,
      accent: b.accent && (ACCENT_NAMES as string[]).includes(b.accent) ? b.accent : "cyan",
    }));
    if (!beats.length) {
      const fallback = type === "TitleHook" ? props.headline : s.narration.split(/\s+/).slice(0, 6).join(" ").replace(/[,.!?।]+$/, "");
      beats = [{ headline: fallback, accent: "cyan" }];
      warnings.push(`scene ${sceneNo}: no headline beats, used "${fallback}"`);
    }
    const section = (s.section ?? s.role).replace(/^\/\/\s*/, "").trim();

    if (s.themeHints !== undefined) repairs.push(`scene ${sceneNo}: dropped themeHints (generation is theme-neutral)`);

    // `beat` is filled in below, once every scene's section is known.
    return { id: `s${sceneNo}`, role: s.role, section, beats, narration: s.narration.trim(), type, props, cues, beat: { mood: DEFAULT_MOOD[s.role] } };
  });

  const beatMeta = buildBeats(
    scenes.map((s, i) => ({ role: s.role, section: s.section ?? s.role, raw: raw.scenes[i].beat })),
    repairs,
    warnings,
  );
  scenes.forEach((s, i) => (s.beat = beatMeta[i]));

  if (scenes[0]?.role !== "hook") warnings.push("first scene is not a hook");
  if (scenes[scenes.length - 1]?.type !== "RecapOutro") warnings.push("last scene is not a RecapOutro");
  else if (!["recap", "outro"].includes(scenes[scenes.length - 1].role)) warnings.push("last scene's role is not recap or outro");
  const [minScenes, maxScenes] = SCENE_RANGE[targetDurationSec];
  if (scenes.length < minScenes || scenes.length > maxScenes) warnings.push(`${scenes.length} scenes; target ${minScenes}-${maxScenes}`);
  for (let i = 2; i < scenes.length; i++) {
    if (scenes[i].type === scenes[i - 1].type && scenes[i].type === scenes[i - 2].type) warnings.push(`scenes ${i - 1}-${i + 1}: three ${scenes[i].type} scenes in a row`);
  }

  const wordCount = scenes.reduce((sum, s) => sum + tokenize(s.narration).length, 0);
  const estimatedDurationSec = (wordCount / WPM[language]) * 60 + scenes.length * 0.5;
  const [minW, maxW] = WORD_BUDGET[language][targetDurationSec];
  if (lengthStatus(wordCount, language, targetDurationSec) !== "ok") {
    warnings.push(`narration is ${wordCount} words; target ${minW}-${maxW}`);
  }

  const title = cutText(raw.title, MAX_TITLE);
  if (title !== raw.title.trim()) repairs.push(`shortened the title to ${MAX_TITLE} characters`);
  let caption = raw.social.caption.trim();
  if (caption.length > MAX_CAPTION) {
    repairs.push(`shortened the caption to ${MAX_CAPTION} characters`);
    caption = cutText(caption, MAX_CAPTION);
  }
  const coverWords = raw.social.coverText.trim().split(/\s+/).filter(Boolean);
  if (coverWords.length > 5) repairs.push("shortened the cover text to 5 words");
  const social = { caption, hashtags: cleanHashtags(raw.social.hashtags, repairs, warnings), coverText: coverWords.slice(0, 5).join(" ") };

  return {
    storyboard: {
      language,
      targetDurationSec,
      title,
      hook: raw.hook.trim(),
      social,
      scenes,
    },
    report: { repairs, warnings, wordCount, estimatedDurationSec: Math.round(estimatedDurationSec) },
  };
}
