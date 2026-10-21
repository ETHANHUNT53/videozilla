import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * F2.7: the Idea Studio laid out as Stitch screen 09, checked in the server HTML (the repo has no DOM test setup).
 * Behaviour of F2.1–F2.8 is covered by the API and helper tests; these check the layout and its accessibility.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", () => ({ apiCall: async () => ({ data: {} }), ApiClientError: class extends Error {} }));

import { mockStoryboard } from "@videozilla/ai";
import { validateStoryboard } from "@videozilla/pipeline";
import { RawStoryboard } from "@videozilla/schema";
import { ProjectView } from "./project-view";

const project = {
  id: "p1",
  title: "Why leaves turn red",
  status: "idea_draft",
  language: "en",
  lengthPreset: 60,
  audience: "students",
  boardOrExam: "cbse",
  styleId: "midnight",
  voiceGender: "female",
  captionsEnabled: true,
  attention: null,
  exportOutdated: false,
  rev: 3,
  updatedAt: "2026-10-20T08:00:00.000Z",
  createdAt: "2026-10-20T07:00:00.000Z",
  allowedActions: ["rename", "edit_idea", "edit_script_settings", "duplicate", "delete"],
};
const card = (id: string, title: string) => ({ id, title, hook: `Hook of ${title}`, angle: "An angle", keyPoints: ["Chlorophyll", "Carotenoids", "Anthocyanins"] });
const brief = { title: "Why leaves turn red", hook: "Leaves hide colours.", angle: "Pigments", audience: "students", keyPoints: ["One", "Two", "Three"], outOfScope: ["Trees"] };
const idea = (over: Record<string, unknown> = {}) => ({
  projectId: "p1",
  mode: "topic",
  topicInput: "leaves",
  ideaInput: "",
  notesText: "",
  suggestions: [card("sg_000000000001", "Leaves as solar panels"), card("sg_000000000002", "Why leaves turn red")],
  brief,
  briefAlternatives: [{ ...brief, title: "Alt 1" }, { ...brief, title: "Alt 2" }],
  briefUpdatedAt: "2026-10-20T08:00:00.000Z",
  briefLanguage: "en",
  briefLengthSec: 60,
  briefCardId: "sg_000000000002",
  rev: 1,
  updatedAt: "2026-10-20T08:00:00.000Z",
  ...over,
});
const render = (ideaOver: Record<string, unknown> = {}, projectOver: Record<string, unknown> = {}) =>
  renderToString(createElement(ProjectView, { initial: { ...project, ...projectOver }, idea: idea(ideaOver), chat: { items: [], hasOlder: false } } as never));
const renderWith = (projectOver: Record<string, unknown>, extra: Record<string, unknown>) =>
  renderToString(createElement(ProjectView, { initial: { ...project, ...projectOver }, idea: idea(), chat: { items: [], hasOlder: false }, ...extra } as never));
const STORYBOARD = validateStoryboard(
  RawStoryboard.parse(mockStoryboard({ brief: { title: "Why leaves turn red", hook: "Leaves hide colours.", angle: "Pigments", keyPoints: ["Chlorophyll", "Carotenoids", "Anthocyanins"], outOfScope: [] }, language: "en", lengthSec: 60, audience: "students" })),
  "en",
  60,
).storyboard;
const VERSION = { version: 2, source: "generate", basedOnVersion: 1, changeSummary: "Regenerated from the brief", changedSceneIds: [], storyboard: STORYBOARD, estimatedDurationSec: 61, wordCount: 137, warnings: [], accuracyFlags: [], isCurrent: true, createdAt: "2026-10-21T08:00:00.000Z" };
const READY = { status: "storyboard_ready", currentStoryboardVersion: 2, voiceGender: "female", allowedActions: ["rename", "edit_idea", "generate", "delete", "duplicate"] };
const RUN = {
  id: "r1",
  projectId: "p1",
  kind: "storyboard",
  status: "running",
  active: true,
  progress: 30,
  steps: [
    { name: "load_context", label: "Reading your brief…", status: "succeeded", attempt: 1 },
    { name: "write_script", label: "Writing your script and planning scenes…", status: "running", attempt: 1 },
    { name: "check", label: "Checking scenes, sync and length…", status: "pending", attempt: 0 },
    { name: "save_version", label: "Saving your storyboard…", status: "pending", attempt: 0 },
  ],
  error: null,
};

describe("Idea Studio layout (Stitch 09)", () => {
  it("ideas first; then the brief with '// refine with ai' inside it, the settings, and Generate storyboard (also the phone order)", () => {
    const html = render();
    const at = (text: string) => {
      const i = html.indexOf(text);
      expect(i, text).toBeGreaterThan(-1);
      return i;
    };
    const order = [at('role="tablist"'), at("Leaves as solar panels"), at('id="brief-title"'), at("refine with ai"), at("settings</p>"), at("Generate storyboard")];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("F3.1: 'Generate storyboard' is live with a brief; 'Next: Storyboard' stays off until there is a storyboard", () => {
    const html = render();
    const tag = (label: string, h = html) => h.slice(h.lastIndexOf("<button", h.indexOf(label)), h.indexOf(label));
    expect(tag("Next: Storyboard →")).toMatch(/disabled=""/);
    expect(tag("Generate storyboard →")).not.toMatch(/disabled=""/);
    // Without a brief it says why it's off.
    const noBrief = render({ brief: null, briefAlternatives: [] });
    expect(tag("Generate storyboard →", noBrief)).toMatch(/disabled=""/);
    expect(tag("Generate storyboard →", noBrief)).toContain('title="Make a brief first."');
  });

  it("F3.1: while generating, the Storyboard step shows the progress steps; Next stays off", () => {
    const html = renderWith({ status: "storyboard_generating", allowedActions: ["rename", "delete", "duplicate"] }, { storyboardRun: RUN });
    expect(html).toContain("Writing your storyboard…");
    for (const label of ["Reading your brief…", "Writing your script and planning scenes…", "Checking scenes, sync and length…", "Saving your storyboard…"]) expect(html).toContain(label);
    expect(html).toContain('role="progressbar"');
    expect(html.slice(html.lastIndexOf("<button", html.indexOf("Next: Storyboard →")), html.indexOf("Next: Storyboard →"))).toMatch(/disabled=""/);
    expect(html).not.toContain('role="tablist"'); // the idea step isn't shown (it's read-only meanwhile)
    // QA: the settings say they are locked while it's written, not "once the video is built".
    expect(html).toContain("Settings are locked while your storyboard is being written.");
    expect(html).not.toContain("once the video is built");
  });

  it("F3.3: the Storyboard step is the review screen: chips, scenes by chapter, on-screen text, caption, Approve disabled, the M5 card", () => {
    const html = renderWith(READY, { storyboard: VERSION });
    // Header: Approve shown disabled with its note, no "Next: Storyboard" here.
    expect(html.slice(html.lastIndexOf("<button", html.indexOf("Approve &amp; create video")), html.indexOf("Approve &amp; create video"))).toMatch(/disabled=""/);
    expect(html).toContain("Building the video arrives in M3");
    expect(html).not.toContain("Next: Storyboard");
    // Chips row.
    for (const chip of ["English", "~<!-- -->60<!-- -->s · est. <!-- -->61<!-- -->s", "8<!-- --> scenes", "Female voice", "Midnight", "Version <!-- -->2"]) expect(html).toContain(chip);
    expect(html).not.toContain("a little");
    // Scene cards, in order, with chapters and what's on screen.
    const at = (t: string) => html.indexOf(t);
    expect(at("S1 · HOOK")).toBeGreaterThan(-1);
    expect(at("chapter <!-- -->1<!-- --> · ")).toBeGreaterThan(at("S1 · HOOK"));
    expect(at("S8 · RECAP")).toBeGreaterThan(at("chapter <!-- -->3<!-- --> · "));
    expect(html.match(/\/\/ on screen:/g)!.length).toBe(8);
    expect(html).toContain("TitleHook");
    expect(html).toContain("Play scene 3 preview");
    expect(html).toMatch(/\d\d:\d\d – \d\d:\d\d/);
    // Caption (read-only until F3.4) and the revision chat placeholder (M5).
    expect(html).toContain("instagram caption");
    expect(html).toContain("#science");
    expect(html).toContain("revise with ai");
    expect(html).toContain("Arrives in M5");
    // Later features are left out, not shown disabled.
    expect(html).not.toMatch(/check fact|Re-order|Delete scene/i);
  });

  it("F3.3: the duration guard turns the chip orange and offers a regenerate when the estimate is outside the window", () => {
    const html = renderWith(READY, { storyboard: { ...VERSION, estimatedDurationSec: 72 } });
    expect(html).toContain("a little long");
    expect(html).toContain("Regenerate it from the Idea step");
  });

  it("F3.3: a failed regenerate is reported on the review screen, with the current storyboard kept", () => {
    const failed = { ...RUN, status: "failed", active: false, error: { code: "AI_BUSY", message: "The AI is busy right now. Try again in a minute.", retryable: true, step: "write_script" } };
    const html = renderWith(READY, { storyboardRun: failed, storyboard: VERSION });
    expect(html).toContain("The new storyboard couldn&#x27;t be made: ");
    expect(html).toContain("Your current storyboard is unchanged.");
    expect(html).toContain("S1 · HOOK");
  });

  it("F3.3: ready but the storyboard not loaded yet: a loading card, not a broken screen", () => {
    const html = renderWith(READY, { storyboard: null });
    expect(html).toContain("Loading your storyboard…");
  });

  it("F3.1: after a failed generation the Idea step says why and that it didn't count", () => {
    const failed = { ...RUN, status: "failed", active: false, error: { code: "AI_BUSY", message: "The AI is busy right now. Try again in a minute.", retryable: true, step: "write_script" } };
    const html = renderWith({}, { storyboardRun: failed });
    expect(html).toContain("The AI is busy right now. Try again in a minute.");
    expect(html).toContain("This didn&#x27;t count against today&#x27;s limit.");
  });

  it("the card the brief came from is marked Selected (in words), and only that one", () => {
    const html = render();
    expect(html.match(/>Selected</g)).toHaveLength(1);
    const selectedCard = html.slice(html.lastIndexOf("<li", html.indexOf(">Selected<")), html.indexOf(">Selected<"));
    expect(selectedCard).toContain("Why leaves turn red");
    expect(selectedCard).toContain('aria-current="true"');
    expect(render({ briefCardId: null }).match(/>Selected</g)).toBeNull();
  });

  it("language and duration are radio groups with the current choice checked", () => {
    const html = render({}, { language: "hi", lengthPreset: 90 });
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>हिंदी</);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>~90s</);
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>English</);
  });

  it("the brief's fields sit under mono labels; key points as a list; Edit is there", () => {
    const html = render();
    // The "// " is decoration, hidden from screen readers (F2.7 QA), so it sits in its own aria-hidden span.
    for (const label of ["hook", "angle", "audience", "key points", "left out to fit the length", "other angles"]) {
      expect(html, label).toContain(`<span aria-hidden="true">// </span>${label}`);
    }
    expect(html).toMatch(/>Edit</);
  });

  it("before a brief: a placeholder card and 'No brief yet'; no chat", () => {
    const html = render({ brief: null, briefAlternatives: [], briefCardId: null, briefUpdatedAt: null });
    expect(html).toContain("Your brief appears here");
    expect(html).toContain("No brief yet");
    expect(html).not.toContain("refine with ai");
  });

  it("the topic row: the input and 'Suggest ideas' together; 'Suggest 5 more' as the pill", () => {
    const html = render();
    expect(html).toContain("Suggest ideas");
    expect(html).toContain("Suggest 5 more");
    expect(html).toContain("[Chlorophyll]");
  });

  it("no '//' is read aloud: every '// ' in the page sits inside an aria-hidden span (F2.7 QA)", () => {
    const html = render();
    const visibleText = html.replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ");
    expect(visibleText).not.toContain("//");
  });

  it("each card's buttons say which card they're for (no 15 identical 'Use this' buttons)", () => {
    const html = render();
    expect(html).toContain('aria-label="Use this: Leaves as solar panels"');
    expect(html).toContain('aria-label="More like this: Leaves as solar panels"');
    expect(html).toContain('aria-label="Use this angle: Alt 1"');
  });

  it("the title: its own wrapping row below lg (chip and 'Next: Storyboard' under it), one row cut with … from lg; the Generate card stays on one row at desktop width", () => {
    const html = render({}, { title: "Biology for class 9: a real-life Indian example of photosynthesis" });
    // The header, from the title-and-chip group to the button.
    const start = html.indexOf("contents lg:flex");
    expect(start).toBeGreaterThan(-1);
    const header = html.slice(start, html.indexOf("Next: Storyboard", start));
    // Below lg: the title's wrapper takes the whole row and the title wraps (QA, F2.7: it shrank to 0 px at 768 / 360).
    expect(header).toContain("basis-full");
    const h1 = html.match(/<h1[^>]*>/)?.[0] ?? "";
    expect(h1).toContain("lg:truncate");
    expect(h1).not.toMatch(/(^|[\s"])truncate/);
    // From lg the full title is on hover.
    expect(header).toContain('title="Rename: Biology for class 9: a real-life Indian example of photosynthesis"');
    // The chip and the button come after the title, not beside it in a row that can't wrap.
    expect(html.indexOf("Draft")).toBeGreaterThan(html.indexOf("<h1"));
    expect(header).not.toContain("sm:flex-nowrap");
    const card = html.slice(html.lastIndexOf("<div", html.indexOf("Brief ready")), html.indexOf("Generate storyboard →"));
    expect(card).toContain("lg:flex-nowrap");
  });

  it("the chat box: a short placeholder that fits a phone, growing with its text (no scrollbar on one line)", () => {
    const html = render();
    const box = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    expect(box).toContain('placeholder="Ask for a change…"');
    expect(box).toContain("[field-sizing:content]");
    expect(box).toContain("resize-none");
  });
});
