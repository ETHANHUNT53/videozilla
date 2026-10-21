/* eslint-disable @typescript-eslint/no-explicit-any -- scene props differ per scene type (each validated by its own Zod schema); typing them per type is a later refactor. */
import { z } from "zod";

export const LANGUAGES = ["en", "hi"] as const;
export type Language = (typeof LANGUAGES)[number];

// ---------- Scene-type props (M0 subset of the PRD catalog, §14.2) ----------

const iconName = z.string().max(40).optional();

export const TitleHookProps = z.object({
  headline: z.string().min(1).max(60),
  subline: z.string().max(60).optional(),
  icon: iconName,
});

export const KeywordRevealProps = z.object({
  keywords: z
    .array(z.object({ id: z.string(), text: z.string().min(1).max(32) }))
    .min(1)
    .max(3),
});

export const BulletStepsProps = z.object({
  title: z.string().max(40).optional(),
  items: z
    .array(z.object({ id: z.string(), text: z.string().min(1).max(70), icon: iconName }))
    .min(2)
    .max(4),
});

export const FlowchartProps = z.object({
  nodes: z
    .array(z.object({ id: z.string(), label: z.string().min(1).max(32), icon: iconName }))
    .min(2)
    .max(5),
});

export const ComparisonProps = z.object({
  left: z.object({ title: z.string().min(1).max(24), points: z.array(z.string().max(40)).min(1).max(3), icon: iconName }),
  right: z.object({ title: z.string().min(1).max(24), points: z.array(z.string().max(40)).min(1).max(3), icon: iconName }),
});

export const StatCounterProps = z.object({
  value: z.number(),
  prefix: z.string().max(4).optional(),
  suffix: z.string().max(12).optional(),
  label: z.string().min(1).max(60),
  icon: iconName,
});

export const RecapOutroProps = z.object({
  points: z.array(z.object({ id: z.string(), text: z.string().min(1).max(50) })).min(1).max(3),
  cta: z.string().min(1).max(50),
});

export const IllustrationProps = z.object({
  title: z.string().max(40).optional(),
  ground: z.boolean().optional(),
  actors: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string().min(1).max(40),
        x: z.number(),
        y: z.number(),
        size: z.enum(["s", "m", "l"]).optional(),
        label: z.string().max(28).optional(),
      }),
    )
    .min(1)
    .max(6),
  flows: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        label: z.string().max(24).optional(),
        style: z.enum(["particles", "beam", "arrow"]).optional(),
        kind: z.string().max(20).optional(),
      }),
    )
    .max(5)
    .default([]),
});

export const UnitGridProps = z.object({
  total: z.number().min(4).max(600),
  unit: z.enum(["dot", "car", "person"]).optional(),
  label: z.string().max(20).optional(),
  states: z
    .array(
      z.object({
        id: z.string(),
        active: z.number().min(0),
        color: z.string().optional(),
        note: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(4),
});

export const SCENE_PROPS = {
  Illustration: IllustrationProps,
  UnitGrid: UnitGridProps,
  TitleHook: TitleHookProps,
  KeywordReveal: KeywordRevealProps,
  BulletSteps: BulletStepsProps,
  Flowchart: FlowchartProps,
  Comparison: ComparisonProps,
  StatCounter: StatCounterProps,
  RecapOutro: RecapOutroProps,
} as const;

export type SceneType = keyof typeof SCENE_PROPS;
export const SCENE_TYPES = Object.keys(SCENE_PROPS) as SceneType[];

/** Element ids each scene type exposes as cue targets. */
export function cueTargetsFor(type: SceneType, props: any): string[] {
  switch (type) {
    case "UnitGrid":
      return props.states.map((s: any) => s.id);
    case "Illustration":
      return [...(props.title ? ["title"] : []), ...props.actors.map((a: any) => a.id), ...(props.flows ?? []).map((f: any) => f.id)];
    case "TitleHook":
      return ["headline", "subline", "icon"];
    case "KeywordReveal":
      return props.keywords.map((k: any) => k.id);
    case "BulletSteps":
      return ["title", ...props.items.map((i: any) => i.id)];
    case "Flowchart":
      return props.nodes.map((n: any) => n.id);
    case "Comparison":
      return ["left", "right"];
    case "StatCounter":
      return ["value", "label"];
    case "RecapOutro":
      return [...props.points.map((p: any) => p.id), "cta"];
  }
}

// ---------- Storyboard (what the LLM produces) ----------

export const Cue = z.object({
  target: z.string(),
  anchor: z.string().min(1),
  occurrence: z.number().int().min(1).optional(),
});
export type Cue = z.infer<typeof Cue>;

/**
 * A headline beat (tech look): a short line at the top of the screen, swapped with a blur as the narration moves on.
 * Words wrapped in *asterisks* are drawn in the accent colour.
 */
export const Beat = z.object({
  headline: z.string().min(1).max(70),
  /** Narration words that bring this headline in (ignored for the first beat, which starts with the scene). */
  anchor: z.string().optional(),
  occurrence: z.number().int().min(1).optional(),
  accent: z.string().optional(),
});
export type Beat = z.infer<typeof Beat>;

// ---------- Story structure (theme-neutral, PRD §13.3, §14.6) ----------

/** What a scene feels like; a theme may map it to its own look (e.g. Mentor's presenter pose). */
export const MOODS = ["curious", "explain", "problem", "solution", "recap"] as const;
export type Mood = (typeof MOODS)[number];

/**
 * A scene's place in the story (`Scene.beat`, singular; not the headline `beats`): its chapter, its mood and the step
 * it adds to a diagram that stays on screen across scenes. It describes the content, never the look, so every theme can
 * read it and new themes need no change here (F4-FR10).
 */
export const BeatMeta = z.object({
  chapter: z
    .object({
      index: z.number().int().min(1).max(5),
      headline: z.string().min(1).max(40),
      subhead: z.string().min(1).max(60).optional(),
    })
    .optional(),
  mood: z.enum(MOODS),
  diagram: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/), step: z.number().int().min(1).max(8) }).optional(),
});
export type BeatMeta = z.infer<typeof BeatMeta>;

/** `beat` as a model writes it: every part optional and malformed parts dropped, since the validator repairs it anyway. */
const RawBeatMeta = z
  .object({
    chapter: z
      .object({
        index: z.number().optional().catch(undefined),
        headline: z.string().optional().catch(undefined),
        subhead: z.string().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    mood: z.string().optional().catch(undefined),
    diagram: z
      .object({ id: z.string().optional().catch(undefined), step: z.number().optional().catch(undefined) })
      .optional()
      .catch(undefined),
  })
  .optional()
  .catch(undefined);

/** A theme id: the key of `themeHints` (and the theme registry, M3). */
export const THEME_ID = /^[a-z][a-z0-9-]{1,31}$/;
/** Largest JSON size of one theme's hints for one scene. */
export const THEME_HINT_MAX_BYTES = 2048;

/**
 * Optional per-theme extras of a scene (PRD §14.6): `{ [themeId]: anything that theme's own hint schema accepts }`.
 * The storyboard never lists themes or their fields, so adding a theme changes nothing here; each theme checks its own
 * value. Here only the key shape and the size are checked.
 */
export const ThemeHints = z.record(z.string().regex(THEME_ID), z.unknown()).superRefine((hints, ctx) => {
  for (const [id, value] of Object.entries(hints)) {
    const size = new TextEncoder().encode(JSON.stringify(value ?? null)).length;
    if (size > THEME_HINT_MAX_BYTES) ctx.addIssue({ code: "custom", path: [id], message: `is ${size} bytes; at most ${THEME_HINT_MAX_BYTES}` });
  }
});
export type ThemeHints = z.infer<typeof ThemeHints>;

export const RawScene = z.object({
  role: z.enum(["hook", "explain", "example", "recap", "outro"]),
  /** Small monospace eyebrow, e.g. "the setup" → rendered as "// the setup". */
  section: z.string().max(40).optional(),
  beats: z.array(Beat).max(3).optional(),
  narration: z.string().min(1),
  type: z.string(),
  props: z.record(z.string(), z.any()),
  cues: z.array(Cue).default([]),
  beat: RawBeatMeta,
  /** Never asked of the model (generation is theme-neutral); dropped by the validator if it writes some. */
  themeHints: z.unknown().optional(),
});

export const RawStoryboard = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  social: z.object({
    caption: z.string(),
    hashtags: z.array(z.string()),
    coverText: z.string(),
  }),
  scenes: z.array(RawScene).min(3),
});
export type RawStoryboard = z.infer<typeof RawStoryboard>;

export interface Scene {
  id: string;
  role: z.infer<typeof RawScene>["role"];
  section?: string;
  beats: Beat[];
  narration: string;
  type: SceneType;
  props: any;
  cues: Cue[];
  /** The scene's place in the story (chapter, mood, diagram step); always set after validation. */
  beat: BeatMeta;
  /** Per-theme extras, filled on demand when a video switches to a theme that needs them (M3). */
  themeHints?: ThemeHints;
}

export interface Storyboard {
  language: Language;
  targetDurationSec: 60 | 90;
  title: string;
  hook: string;
  social: RawStoryboard["social"];
  scenes: Scene[];
}

// ---------- Timeline (resolved, frame-based; input to the renderer) ----------

export interface CaptionWord {
  text: string;
  from: number; // frame, relative to video start
  to: number;
}

export interface CaptionPhrase {
  from: number;
  to: number;
  words: CaptionWord[];
}

export interface TimelineScene {
  id: string;
  type: SceneType;
  role: Scene["role"];
  props: any;
  from: number;
  durationInFrames: number;
  audioSrc: string | null; // path relative to /public
  /** Frame (relative to scene start) at which each element appears. */
  cueFrames: Record<string, number>;
}

export interface HeadlineBeat {
  from: number;
  to: number;
  /** Headline with *accented* words. */
  text: string;
  accent: string;
  section: string;
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  language: Language;
  styleId: string;
  title: string;
  scenes: TimelineScene[];
  captions: CaptionPhrase[];
  headlines: HeadlineBeat[];
}
