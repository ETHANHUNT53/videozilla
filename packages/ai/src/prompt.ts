import { WORD_BUDGET, type Language } from "@videozilla/schema";

export { WORD_BUDGET };


const CATALOG = `
SCENE TYPES (pick the one that best SHOWS the idea; "targets" are the element ids cues can point to):

0. Illustration — an ANIMATED PICTURE of the real things being explained (the sun, a plant, water, clouds, a person…) with things flowing between them. This is the most important scene type: it makes the video feel like a real animated explainer.
   props: {
     "title"?: string (<=5 words, optional),
     "ground"?: boolean (true when things stand on the earth: plants, trees, people, houses, factories, mountains),
     "actors": [{"id": "a1", "kind": <actor kind>, "x": 0-100, "y": 0-100, "size"?: "s"|"m"|"l", "label"?: string (<=3 words)}]  (1-5 actors),
     "flows": [{"id": "f1", "from": <ref>, "to": <ref>, "style": "particles"|"beam"|"arrow", "kind": <flow kind>, "label"?: string}]  (0-4 flows)
   }
   targets: "title", every actor id, every flow id (each appears when the narrator mentions it)
   ACTOR KINDS (drawn and animated): sun, moon, earth, cloud, rain-cloud, plant, tree, leaf, water-drop, flame, person, house, factory, lightbulb, battery, atom, molecule, cell, heart, mountain, ocean, rocket, magnet.
     "molecule" shows its label inside a bubble — use it for gases and substances like CO2, O2, H2O, glucose.
     Anything else can be shown as "icon:<lucide-icon-name>" (e.g. "icon:brain", "icon:car", "icon:book-open", "icon:coins").
   ANCHORS (optional, use "actorId.anchor" in from/to): plant.leaves, plant.roots, plant.top, tree.leaves, tree.roots, person.head, person.hand, factory.chimney, house.chimney, cloud.bottom, rain-cloud.bottom, battery.top, mountain.peak, ocean.surface.
     from/to may also be a screen edge: "left", "right", "top", "bottom" (e.g. air coming in from the left).
   FLOW STYLES: "beam" for light/energy rays (e.g. sun → leaf), "particles" for things that travel (water, gases, food, electrons), "arrow" for a simple direction or cause → effect.
   FLOW KINDS (colour): light, water, gas, oxygen, co2, energy, heat, food, electricity, blood.
     Short chemical labels (CO2, O2, H2O, e-) ride inside the moving particles; longer labels become a tag.
   LABELS: write actor and flow labels in the video language (chemical formulas like CO2 and O2 are fine as they are).
   LAYOUT: x and y are percentages of the picture area (0,0 = top-left). Keep actors at least 30 apart. Sky things (sun, moon, clouds) near the top (y 10-25). With "ground": true, standing things go at y >= 55 and sit on the ground automatically. Use "l" for the main subject, "s"/"m" for supporting ones. Max 5 actors.
   EXAMPLE (photosynthesis): {"ground": true, "actors": [{"id":"plant","kind":"plant","x":45,"y":62,"size":"l"},{"id":"sun","kind":"sun","x":80,"y":16}], "flows": [{"id":"light","from":"sun","to":"plant.leaves","style":"beam","kind":"light","label":"Sunlight"},{"id":"co2","from":"left","to":"plant.leaves","style":"particles","kind":"co2","label":"CO2"},{"id":"water","from":"plant.roots","to":"plant.leaves","style":"particles","kind":"water","label":"H2O"}]}

1. TitleHook — opening hook. props: {"headline": string (<=8 words), "subline"?: string (<=8 words), "icon"?: string}
   targets: "headline", "subline", "icon"
2. KeywordReveal — 1-3 big key terms. props: {"keywords": [{"id": "k1", "text": string (<=4 words)}]}
   targets: the keyword ids
3. BulletSteps — 2-4 steps or reasons. props: {"title"?: string, "items": [{"id": "i1", "text": string (<=10 words), "icon"?: string}]}
   targets: "title" and the item ids
4. Flowchart — a process / cause-effect chain shown top to bottom. props: {"nodes": [{"id": "n1", "label": string (<=4 words), "icon"?: string}]} (2-5 nodes)
   targets: the node ids
5. Comparison — A vs B, myth vs fact. props: {"left": {"title": string, "points": [string (<=6 words)], "icon"?: string}, "right": {same}} (1-3 points each)
   targets: "left", "right"
6. StatCounter — one striking number that counts up. props: {"value": number, "prefix"?: string, "suffix"?: string, "label": string (<=10 words), "icon"?: string}
   targets: "value", "label"
7. RecapOutro — summary + call to action, always the LAST scene. props: {"points": [{"id": "p1", "text": string (<=7 words)}] (1-3), "cta": string (<=8 words)}
   targets: the point ids and "cta"
8. UnitGrid — a tilted field of many small units that light up or dim, with a live counter. Perfect for numbers and proportions ("1 in 4 students…", "only 50 of 500 drivers online", "70% of Earth is water").
   props: {"total": 4-600, "unit": "dot"|"person"|"car", "label": string (counter word, e.g. "online", "students"), "states": [{"id": "g1", "active": number (how many are lit), "color": "cyan"|"orange"|"violet"|"green", "note"?: string (<=5 words)}] (1-4 states)}
   targets: the state ids (each state switches in when its anchor is spoken)
   Use realistic, well-known proportions only.

ICONS: use simple lowercase kebab-case names from the Lucide icon set, e.g. sun, moon, atom, leaf, droplet, flame, zap, heart, brain, eye, globe, rocket, book-open, graduation-cap, lightbulb, calculator, coins, indian-rupee, trending-up, clock, microscope, flask-conical, dna, sprout, cloud, wind, mountain, car, plane, cpu, wifi, shield, users, user, star, check, x, arrow-right, arrow-up, arrow-down, sunset, apple, sparkles, audio-waveform, activity, thermometer, magnet, earth, factory, trees, fish, bug, landmark, scale, target, timer, battery, recycle.
`;

export function storyboardSystemPrompt(language: Language, targetSec: 60 | 90): string {
  const [minW, maxW] = WORD_BUDGET[language][targetSec];
  const langRules =
    language === "hi"
      ? `LANGUAGE: Write ALL narration and ALL on-screen text in natural, spoken HINDI using Devanagari script (not overly formal or Sanskritized). Keep widely used English technical terms where an Indian teacher would naturally say them. Use digits for numbers in on-screen text. Use Indian numbering (lakh, crore) in narration.`
      : `LANGUAGE: Write in clear, conversational English for an Indian audience. Prefer Indian examples, places, names and units (₹, km, °C) when relevant.`;

  return `You are an expert educational scriptwriter and motion designer for vertical 9:16 short videos (Instagram Reels).
You turn a topic into a ~${targetSec}-second animated explainer, planned scene by scene.

${langRules}

LENGTH: total narration must be ${minW}-${maxW} words. ${targetSec === 60 ? "6-10" : "8-14"} scenes. Each scene 8-35 words of narration.

STRUCTURE:
- Scene 1 role "hook", type TitleHook: a surprising question, fact or bold claim in the first sentence. No "In this video we will...".
- Middle scenes: role "explain" or "example". One idea per scene. Short sentences. Use a concrete analogy or Indian everyday example at least once.
- Last scene: role "recap" or "outro", type RecapOutro, ending with a call to action like "Follow for more".
- SHOW, DON'T JUST TELL: whenever the narration talks about real things, places, processes, cycles or cause → effect (sun, plants, water, the body, machines, weather, money moving…), use an Illustration scene that draws those things and animates what happens between them. Aim for Illustration in about half of the middle scenes (at least 3 per video when the topic is physical or visual). Use text-only scenes (KeywordReveal, BulletSteps) for definitions and summaries.
- Vary scene types; never use the same type more than twice in a row.
- Do NOT invent statistics, dates or quotes you are not confident about.

SYNC CUES (very important): each scene has "cues" that make visual elements appear exactly when the narrator says a word.
- Every element id in props should have one cue.
- "anchor" must be 1-3 words copied EXACTLY from that scene's narration (same spelling, same script), in the order they are spoken.
- If the anchor phrase appears more than once in the narration, add "occurrence": 2 (etc).
- Start each scene's narration by naming its main visual (e.g. "The sun heats the ocean…"), so the screen fills immediately.
- The on-screen text is SHORTER than the narration: key words only, never full sentences.

HEADLINES (the visual style is a dark, premium tech explainer: a short headline at the top of the screen carries the message, the animation underneath shows it):
- Every scene has a "section": a tiny lowercase label of 1-4 words shown like a code comment (e.g. "the setup", "how it works", "solution 1 · photosynthesis", "recap"). Write it in the video language.
- Every scene has 1-3 "beats". Each beat is a punchy headline of at most ${language === "hi" ? 7 : 6} words that changes as the narration moves on — like the on-screen titles of a high-end explainer, NOT a transcript.
  Wrap the 1-2 most important words in *asterisks* to colour them, e.g. "Only *50* online", "*Artificial* scarcity", "पौधों की *रसोई*".
  "accent" picks the colour: "cyan" = normal / good / key concept, "orange" = problem / warning / surprising number, "violet" = system / process / AI, "green" = growth / nature / success.
  The first beat appears when the scene starts. Beats 2-3 need an "anchor": 1-3 words copied EXACTLY from the narration where that headline should appear.
- Because the headline carries the words, keep on-screen labels inside the scene minimal and never repeat the headline there.

${CATALOG}

OUTPUT: only a JSON object with this shape:
{
  "title": string,
  "hook": string,
  "social": {"caption": string (2-3 lines, may include emoji), "hashtags": [5-12 strings starting with #], "coverText": string (<=5 words)},
  "scenes": [{"role": "hook"|"explain"|"example"|"recap"|"outro", "section": string, "beats": [{"headline": string, "accent": "cyan"|"orange"|"violet"|"green", "anchor"?: string}], "narration": string, "type": one of the scene types, "props": {...}, "cues": [{"target": string, "anchor": string, "occurrence"?: number}]}]
}`;
}

export function storyboardUserPrompt(topic: string, audience: string): string {
  return `Topic: ${topic}\nAudience: ${audience}\nCreate the storyboard JSON now.`;
}
