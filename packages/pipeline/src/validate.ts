import {
  ACCENT_NAMES,
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
    if (wc < 5 || wc > 40) warnings.push(`scene ${sceneNo}: ${wc} words of narration (target 8-35)`);

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

    return { id: `s${sceneNo}`, role: s.role, section, beats, narration: s.narration.trim(), type, props, cues };
  });

  if (scenes[0]?.role !== "hook") warnings.push("first scene is not a hook");
  if (scenes[scenes.length - 1]?.type !== "RecapOutro") warnings.push("last scene is not a RecapOutro");

  const wordCount = scenes.reduce((sum, s) => sum + tokenize(s.narration).length, 0);
  const estimatedDurationSec = (wordCount / WPM[language]) * 60 + scenes.length * 0.5;
  const [minW, maxW] = WORD_BUDGET[language][targetDurationSec];
  if (wordCount < minW * 0.85 || wordCount > maxW * 1.15) {
    warnings.push(`narration is ${wordCount} words; target ${minW}-${maxW}`);
  }

  return {
    storyboard: {
      language,
      targetDurationSec,
      title: raw.title,
      hook: raw.hook,
      social: raw.social,
      scenes,
    },
    report: { repairs, warnings, wordCount, estimatedDurationSec: Math.round(estimatedDurationSec) },
  };
}
