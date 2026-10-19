import { ProviderError } from "./backend";
import type { IdeaBrief, IdeaBriefInput } from "./brief";
import type { IdeaChatInput } from "./idea-chat";
import type { IdeaCard, IdeaLanguage, IdeaSuggestionsInput } from "./ideas";

/**
 * Sample replies for `AI_PROVIDER=mock`: the app works end to end with no AI call, so manual testing doesn't spend the
 * free Groq / OpenRouter limits. Built from the typed topic, in the video's language, and marked "[Mock]" in every hook
 * so nobody mistakes them for model output.
 *
 * Test triggers in the topic or idea text (so error paths can be tried without typing a harmful topic):
 * - `[mock:refuse]` → the model's refusal (422 UNSAFE_CONTENT, category "other");
 * - `[mock:busy]`   → the AI stays busy (503 AI_BUSY, the request is given back).
 */

const REFUSE = "[mock:refuse]";
const BUSY = "[mock:busy]";

function trigger(text: string): { refused: true; category: "other"; reason: string } | null {
  if (text.includes(BUSY)) throw new ProviderError("mock: busy (test trigger [mock:busy])", "busy");
  return text.includes(REFUSE) ? { refused: true, category: "other", reason: "test trigger [mock:refuse]" } : null;
}

/** The subject, without triggers, at most ~50 characters (cut at a word). */
function subject(text: string, language: IdeaLanguage): string {
  const clean = text.replace(REFUSE, "").replace(BUSY, "").replace(/\s+/g, " ").trim();
  if (!clean) return language === "hi" ? "यह विषय" : "this topic";
  if (clean.length <= 50) return clean;
  const cut = clean.slice(0, 50);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 50)}…`;
}

/** Ten idea templates per language; "Suggest 5 more" moves on to the ones not shown yet. */
const IDEAS: Record<IdeaLanguage, { title: (t: string) => string; angle: string }[]> = {
  en: [
    { title: (t) => `Why ${t} matters more than you think`, angle: "Starts from an everyday surprise, then explains the idea behind it." },
    { title: (t) => `${t} explained in 60 seconds`, angle: "The shortest clear explanation, with one picture that sticks." },
    { title: (t) => `The one mistake everyone makes about ${t}`, angle: "Busts a common misconception before teaching the right idea." },
    { title: (t) => `${t}: a real-life Indian example`, angle: "Teaches through one familiar Indian example from daily life." },
    { title: (t) => `How ${t} actually works, step by step`, angle: "Walks through the process one clear step at a time." },
    { title: (t) => `${t}: myths vs facts`, angle: "Three quick myths, each answered with a fact." },
    { title: (t) => `The story of ${t} in one minute`, angle: "Tells how the idea was discovered, as a short story." },
    { title: (t) => `${t} with a simple experiment at home`, angle: "Shows an easy, safe experiment that makes the idea visible." },
    { title: (t) => `3 numbers that explain ${t}`, angle: "Uses three striking numbers to build understanding." },
    { title: (t) => `What if ${t} didn't exist?`, angle: "A thought experiment that shows why the idea matters." },
  ],
  hi: [
    { title: (t) => `${t} क्यों ज़रूरी है?`, angle: "रोज़ की एक हैरान करने वाली बात से शुरू करके उसके पीछे का विचार समझाना।" },
    { title: (t) => `60 सेकंड में ${t}`, angle: "सबसे छोटी और साफ़ व्याख्या, एक याद रहने वाली तस्वीर के साथ।" },
    { title: (t) => `${t} के बारे में सबसे आम गलती`, angle: "पहले एक आम गलतफ़हमी तोड़ना, फिर सही बात सिखाना।" },
    { title: (t) => `${t}: भारत का एक असली उदाहरण`, angle: "रोज़मर्रा के एक जाने-पहचाने भारतीय उदाहरण से सिखाना।" },
    { title: (t) => `${t} असल में कैसे काम करता है`, angle: "पूरी प्रक्रिया को एक-एक आसान कदम में समझाना।" },
    { title: (t) => `${t}: मिथक बनाम सच`, angle: "तीन छोटे मिथक, हर एक का जवाब एक तथ्य से।" },
    { title: (t) => `एक मिनट में ${t} की कहानी`, angle: "यह विचार कैसे खोजा गया, एक छोटी कहानी की तरह।" },
    { title: (t) => `घर पर एक आसान प्रयोग से ${t}`, angle: "एक आसान और सुरक्षित प्रयोग जो विचार को दिखा दे।" },
    { title: (t) => `3 आंकड़े जो ${t} समझाते हैं`, angle: "तीन चौंकाने वाले आंकड़ों से समझ बनाना।" },
    { title: (t) => `अगर ${t} न होता तो?`, angle: "एक सोच-प्रयोग जो दिखाए कि यह विचार क्यों मायने रखता है।" },
  ],
};

const TEXT = {
  en: {
    hook: (t: string) => `[Mock] Have you ever noticed ${t} in your everyday life?`,
    points: (t: string) => [`What ${t} is`, "How it works", "One everyday example"],
    briefPoints: (t: string) => [`What ${t} is, in one line`, "The key idea, with a picture", "One everyday Indian example", "A quick recap question"],
    outOfScope: ["Formulas and derivations", "History beyond one line"],
    altAngles: ["A story-first angle: one character meets the idea.", "A myth-busting angle: start from what people get wrong."],
    altTitles: (t: string) => [`The story behind ${t}`, `${t}: what most people get wrong`],
    notesSummary: (t: string) => `[Mock] Your notes cover ${t} and a few related points.`,
  },
  hi: {
    hook: (t: string) => `[Mock] क्या आपने कभी अपने रोज़ के जीवन में ${t} पर ध्यान दिया है?`,
    points: (t: string) => [`${t} क्या है`, "यह कैसे काम करता है", "रोज़मर्रा का एक उदाहरण"],
    briefPoints: (t: string) => [`${t} एक लाइन में`, "मुख्य विचार, एक तस्वीर के साथ", "भारत का एक रोज़मर्रा का उदाहरण", "एक छोटा दोहराव सवाल"],
    outOfScope: ["सूत्र और गणनाएँ", "एक लाइन से ज़्यादा इतिहास"],
    altAngles: ["कहानी से शुरुआत: एक किरदार इस विचार से मिलता है।", "मिथक तोड़ना: लोग जो गलत समझते हैं, वहीं से शुरुआत।"],
    altTitles: (t: string) => [`${t} के पीछे की कहानी`, `${t}: ज़्यादातर लोग क्या गलत समझते हैं`],
    notesSummary: (t: string) => `[Mock] आपके नोट्स ${t} और उससे जुड़ी कुछ बातों के बारे में हैं।`,
  },
};

/** The notes' first line with content (their heading, usually): the mock brief's subject. */
const firstLine = (notes: string) =>
  notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s#*\-•\d.)]+/u, "").trim())
    .find((l) => /[\p{L}\p{N}]/u.test(l)) ?? "";

/** Five sample idea cards (or a test refusal / busy). */
export function mockIdeas(input: IdeaSuggestionsInput): unknown {
  const refusal = trigger(input.topic);
  if (refusal) return refusal;
  const t = subject(input.topic, input.language);
  const shown = new Set(input.avoidTitles ?? []);
  const all = IDEAS[input.language];
  // New concepts first; once all ten were shown, start again with a round number so titles stay distinct.
  const fresh = all.filter((tpl) => !shown.has(tpl.title(t)));
  const round = Math.floor((input.avoidTitles?.length ?? 0) / all.length) + 1;
  const picked = (fresh.length >= 5 ? fresh : all).slice(0, 5);
  const ideas: IdeaCard[] = picked.map((tpl) => ({
    title: fresh.length >= 5 ? tpl.title(t) : `${tpl.title(t)} (${round})`,
    hook: TEXT[input.language].hook(t),
    angle: tpl.angle,
    keyPoints: TEXT[input.language].points(t),
  }));
  return { ideas };
}

/** A sample brief and 2 other angles (or a test refusal / busy). */
export function mockBrief(input: IdeaBriefInput): unknown {
  const text = input.source.kind === "card" ? `${input.source.title} ${input.source.hook}` : input.source.text;
  const refusal = trigger(text);
  if (refusal) return refusal;
  const L = TEXT[input.language];
  const t = subject(input.source.kind === "idea" ? input.source.text : input.source.kind === "notes" ? firstLine(input.source.text) : input.source.title, input.language);
  const count = input.lengthSec === 60 ? 3 : 4;
  const make = (title: string, angle: string, hook: string): IdeaBrief => ({
    title: title.slice(0, 120),
    hook,
    angle,
    audience: input.audience,
    keyPoints: L.briefPoints(t).slice(0, count),
    outOfScope: L.outOfScope,
    ...(input.source.kind === "notes" ? { sourceNotesSummary: L.notesSummary(t) } : {}),
  });
  const brief =
    input.source.kind === "card"
      ? make(input.source.title, input.source.angle, input.source.hook.startsWith("[Mock]") ? input.source.hook : `[Mock] ${input.source.hook}`)
      : make(IDEAS[input.language][1].title(t), IDEAS[input.language][1].angle, L.hook(t));
  const alternatives = L.altTitles(t).map((title, i) => make(title, L.altAngles[i], L.hook(t)));
  return { brief, alternatives };
}

const ASK = "[mock:ask]";

/**
 * A sample chat answer (F2.5): the hook is rewritten (so a change shows), and "kids" in the message sets the audience
 * to kids. `[mock:ask]` gives a clarification question; `[mock:refuse]` / `[mock:busy]` as above.
 */
export function mockIdeaChat(input: IdeaChatInput): unknown {
  const refusal = trigger(input.message);
  if (refusal) return refusal;
  const hi = input.language === "hi";
  if (input.message.includes(ASK)) {
    return { status: "clarification", reply: hi ? "[Mock] आप किस बिंदु की बात कर रहे हैं — पहला या दूसरा?" : "[Mock] Which point do you mean — the first or the second?" };
  }
  const kids = /\bkids?\b|बच्च/i.test(input.message);
  const base = input.brief.hook.replace(/^\[Mock\]\s*/, "");
  const brief: IdeaBrief = {
    ...input.brief,
    hook: `[Mock] ${hi ? "नया हुक:" : "New hook:"} ${base}`.slice(0, 300),
    audience: kids ? "kids" : input.brief.audience,
  };
  const reply = hi ? `[Mock] मैंने हुक बदल दिया${kids ? " और दर्शक बच्चे कर दिए" : ""}।` : `[Mock] I rewrote the hook${kids ? " and set the audience to kids" : ""}.`;
  return { status: "applied", reply, brief };
}
