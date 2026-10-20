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

  it("'Next: Storyboard' and 'Generate storyboard' are there and disabled until the storyboard step exists", () => {
    const html = render();
    for (const label of ["Next: Storyboard →", "Generate storyboard →"]) {
      const button = html.slice(html.lastIndexOf("<button", html.indexOf(label)), html.indexOf(label));
      expect(button, label).toMatch(/disabled=""/);
    }
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

  it("a long title shortens instead of pushing 'Next: Storyboard' under it; the Generate card stays on one row at desktop width", () => {
    const html = render({}, { title: "Biology for class 9: a real-life Indian example of photosynthesis" });
    const header = html.slice(html.indexOf("sm:flex-nowrap"), html.indexOf("Next: Storyboard"));
    expect(header).toContain("truncate");
    expect(header).toContain('title="Rename: Biology for class 9: a real-life Indian example of photosynthesis"');
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
