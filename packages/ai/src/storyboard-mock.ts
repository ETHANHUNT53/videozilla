import { WORD_BUDGET } from "@videozilla/schema";
import { ProviderError } from "./backend";
import type { StoryboardInput } from "./storyboard";

/**
 * A sample storyboard for `AI_PROVIDER=mock` (F3.1): built from the brief, in the video's language, inside the 60 / 90 s
 * word budget, with chapters, moods and one growing diagram, so the whole generate flow works with no AI call. Every
 * hook starts with "[Mock]".
 *
 * Test triggers in the brief's title or hook:
 * - `[mock:refuse]` → the model refuses (the run fails with UNSAFE_CONTENT);
 * - `[mock:busy]`   → the AI stays busy (AI_BUSY, the unit is given back);
 * - `[mock:long]`   → the first script is far too long, so the job's one length fix runs (and returns a fitting one).
 */

const REFUSE = "[mock:refuse]";
const BUSY = "[mock:busy]";
const LONG = "[mock:long]";

const TEXT = {
  en: {
    hookLead: "[Mock] Have you ever wondered about this?",
    pointLead: (p: string) => `${p}.`,
    filler:
      "Picture it with something you see every single day at home or at school and it suddenly becomes easy to remember for a long time".split(" "),
    recap: "So let us quickly recap the big ideas we just saw together.",
    cta: "Follow for more",
    chapter: (i: number) => `Part ${i}`,
    caption: (t: string) => `[Mock] ${t}, explained in one short reel.`,
    tags: ["#science", "#learning", "#education", "#explained", "#india", "#reels"],
  },
  hi: {
    hookLead: "[Mock] क्या आपने कभी इसके बारे में सोचा है?",
    pointLead: (p: string) => `${p}।`,
    filler: "इसे रोज़ की किसी आम चीज़ से जोड़कर देखिए तो यह बात बहुत आसानी से समझ में आती है और लंबे समय तक याद रहती है".split(" "),
    recap: "तो चलिए अब जल्दी से सारी बड़ी बातें दोहरा लेते हैं।",
    cta: "और जानने के लिए फ़ॉलो करें",
    chapter: (i: number) => `भाग ${i}`,
    caption: (t: string) => `[Mock] ${t}, एक छोटी रील में।`,
    tags: ["#विज्ञान", "#पढ़ाई", "#education", "#explained", "#india", "#reels"],
  },
};

/** `lead`, then filler words, to exactly `count` words. */
function words(lead: string, filler: string[], count: number): string {
  const out = lead.split(/\s+/).filter(Boolean).slice(0, count);
  for (let i = 0; out.length < count; i++) out.push(filler[i % filler.length]);
  return out.join(" ");
}

/** The first `n` words of `text`, at most `max` characters (on-screen labels). */
const label = (text: string, n: number, max: number) => text.replace(/[.,!?।]/g, "").split(/\s+/).filter(Boolean).slice(0, n).join(" ").slice(0, max) || "…";

const TYPES = ["KeywordReveal", "BulletSteps", "Flowchart"] as const;

export function mockStoryboard(input: StoryboardInput, opts: { lengthFix?: boolean } = {}): unknown {
  const b = input.brief;
  const marker = `${b.title} ${b.hook}`;
  if (marker.includes(BUSY)) throw new ProviderError("mock: busy (test trigger [mock:busy])", "busy");
  if (marker.includes(REFUSE)) return { refused: true, category: "other", reason: "test trigger [mock:refuse]" };

  const L = TEXT[input.language];
  const [minW, maxW] = WORD_BUDGET[input.language][input.lengthSec];
  const long = marker.includes(LONG) && !opts.lengthFix;
  const total = Math.round(((minW + maxW) / 2) * (long ? 1.8 : 1));
  const chapters = input.lengthSec === 60 ? 3 : 4;
  const bodyCount = input.lengthSec === 60 ? 6 : 9;
  const sceneCount = bodyCount + 2;
  const per = Math.floor(total / sceneCount);
  const extra = total - per * sceneCount; // the hook takes the remainder, so the total is exact
  const points = b.keyPoints.length ? b.keyPoints : [b.title];

  const scenes: unknown[] = [];
  const hookText = words(`${L.hookLead} ${b.hook.replace(/^\[Mock\]\s*/, "")}`, L.filler, per + extra);
  const headline = label(b.title, 6, 60);
  scenes.push({
    role: "hook",
    section: input.language === "hi" ? "शुरुआत" : "the hook",
    beats: [{ headline, accent: "orange" }],
    narration: hookText,
    type: "TitleHook",
    props: { headline },
    cues: [],
    beat: { mood: "curious" },
  });

  for (let i = 0; i < bodyCount; i++) {
    const chapter = Math.min(chapters, Math.floor((i * chapters) / bodyCount) + 1);
    const point = points[(chapter - 1) % points.length];
    const narration = words(L.pointLead(point), L.filler, per);
    const first = narration.split(" ")[0].replace(/[.,!?।]/g, "");
    const type = TYPES[i % TYPES.length];
    const props =
      type === "KeywordReveal"
        ? { keywords: [{ id: "k1", text: label(point, 3, 32) }] }
        : type === "BulletSteps"
          ? { items: [{ id: "i1", text: label(point, 6, 70) }, { id: "i2", text: label(L.filler.join(" "), 4, 70) }] }
          : { nodes: [{ id: "n1", label: label(point, 3, 32) }, { id: "n2", label: label(L.filler.join(" "), 3, 32) }] };
    const target = type === "KeywordReveal" ? "k1" : type === "BulletSteps" ? "i1" : "n1";
    scenes.push({
      role: i % 3 === 2 ? "example" : "explain",
      section: L.chapter(chapter),
      beats: [{ headline: label(point, 5, 60), accent: "cyan" }],
      narration,
      type,
      props,
      cues: [{ target, anchor: first }],
      beat: {
        chapter: { index: chapter, headline: label(point, 5, 40) },
        mood: (["problem", "explain", "solution"] as const)[i % 3],
        ...(i < 6 ? { diagram: { id: "main", step: i + 1 } } : {}),
      },
    });
  }

  scenes.push({
    role: "recap",
    section: input.language === "hi" ? "दोहराव" : "recap",
    beats: [{ headline: label(b.title, 5, 60), accent: "green" }],
    narration: words(L.recap, L.filler, per),
    type: "RecapOutro",
    props: { points: points.slice(0, 3).map((p, i) => ({ id: `p${i + 1}`, text: label(p, 5, 50) })), cta: L.cta },
    cues: [],
    beat: { mood: "recap" },
  });

  return {
    title: b.title.slice(0, 70),
    hook: `[Mock] ${b.hook.replace(/^\[Mock\]\s*/, "")}`,
    social: { caption: L.caption(b.title), hashtags: L.tags, coverText: label(b.title, 4, 40) },
    scenes,
  };
}
