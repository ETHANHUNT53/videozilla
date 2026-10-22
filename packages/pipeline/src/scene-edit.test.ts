/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke at props of every scene type. */
import { SCENE_PROPS, SCENE_TYPES, type Scene, type Storyboard } from "@videozilla/schema";
import { describe, expect, it } from "vitest";
import { applySceneOp, cleanProps, convertProps, describeChanges, findAnchor, measureStoryboard, needsConfirm, propTexts, rebuildCues, reflowBeats, sceneProblems } from "./scene-edit";

/** F3.6: manual scene edits as one pure step (shared by the page and the API). */

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({
  id,
  role: "explain",
  section: "part",
  beats: [{ headline: `Headline ${id}`, accent: "cyan" }],
  narration: "Sunlight looks white but it hides every colour of the rainbow inside it.",
  type: "KeywordReveal",
  props: { keywords: [{ id: "k1", text: "white light" }] },
  cues: [{ target: "k1", anchor: "white" }],
  beat: { mood: "explain" },
  ...over,
});

/** hook, 2 scenes in chapter 1, 2 in chapter 2, recap. */
function board(): Storyboard {
  return {
    language: "en",
    targetDurationSec: 60,
    title: "Sky",
    hook: "Why blue?",
    social: { caption: "c", hashtags: [], coverText: "c" },
    scenes: [
      scene("s1", { role: "hook", type: "TitleHook", props: { headline: "Why blue?" }, cues: [{ target: "headline", anchor: "Sunlight" }], beat: { mood: "curious" } }),
      scene("s2", { beat: { mood: "explain", chapter: { index: 1, headline: "Light" }, diagram: { id: "main", step: 1 } } }),
      scene("s3", { beat: { mood: "explain", chapter: { index: 1, headline: "Light" }, diagram: { id: "main", step: 2 } } }),
      scene("s4", { beat: { mood: "problem", chapter: { index: 2, headline: "Air" }, diagram: { id: "main", step: 3 } }, themeHints: { mentor: { pose: "point" } } }),
      scene("s5", { beat: { mood: "solution", chapter: { index: 2, headline: "Air" } } }),
      scene("s6", { role: "recap", type: "RecapOutro", props: { points: [{ id: "p1", text: "Blue scatters" }], cta: "Follow" }, cues: [], beat: { mood: "recap" } }),
    ],
  };
}

describe("type forms and conversion", () => {
  it("every renderable scene type has a form whose cleaned output passes its own schema once filled", () => {
    expect(Object.keys(SCENE_PROPS).sort()).toEqual([...SCENE_TYPES].sort());
    const ok = applySceneOp(board(), { kind: "edit", sceneId: "s2", props: { keywords: [{ id: "k1", text: "  white   light " }] } });
    expect(ok.ok && ok.storyboard.scenes[1].props.keywords[0].text).toBe("white light");
    expect(cleanProps("TitleHook", { headline: "Hi", subline: "  " })).toEqual({ headline: "Hi" });
  });

  it("collects a scene's on-screen texts and carries them into another type; empty where nothing maps", () => {
    const bullets = { title: "Steps", items: [{ id: "i1", text: "Cut" }, { id: "i2", text: "Cry" }] };
    expect(propTexts("BulletSteps", bullets)).toEqual(["Steps", "Cut", "Cry"]);
    expect(convertProps("BulletSteps", bullets, "Flowchart")).toEqual({ nodes: [{ id: "n1", label: "Steps" }, { id: "n2", label: "Cut" }, { id: "n3", label: "Cry" }] });
    expect(convertProps("BulletSteps", bullets, "TitleHook")).toEqual({ headline: "Steps", subline: "Cut" });
    expect(convertProps("KeywordReveal", { keywords: [{ id: "k1", text: "70% water" }] }, "StatCounter", "")).toEqual({ value: 70, label: "" });
    expect(convertProps("TitleHook", { headline: "Why?" }, "RecapOutro")).toEqual({ points: [{ id: "p1", text: "Why?" }], cta: "" });
    const ill = convertProps("KeywordReveal", { keywords: [{ id: "k1", text: "Sun" }] }, "Illustration");
    expect(ill.actors[0]).toMatchObject({ id: "a1", kind: "", label: "Sun", y: 55 });
  });

  it("an empty field after a type change blocks the save with a field path", () => {
    const r = applySceneOp(board(), { kind: "edit", sceneId: "s2", type: "RecapOutro" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.map((p) => p.field)).toContain("props.cta");
    expect(sceneProblems({ narration: "x", type: "Flowchart", props: { nodes: [{ id: "n1", label: "only one" }] }, beats: [] })[0].field).toBe("props.nodes");
  });
});

describe("edit", () => {
  it("a new version of only that scene: other scenes identical, beat and themeHints kept", () => {
    const sb = board();
    const r = applySceneOp(sb, { kind: "edit", sceneId: "s4", narration: "Air scatters the white sunlight all over the sky above us today." });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.storyboard.scenes.filter((s) => s.id !== "s4")).toEqual(sb.scenes.filter((s) => s.id !== "s4"));
    expect(r.storyboard.scenes[3]).toMatchObject({ beat: sb.scenes[3].beat, themeHints: { mentor: { pose: "point" } } });
    expect(r.changedSceneIds).toEqual(["s4"]);
    expect(r.summary).toBe("Edited scene 4");
  });

  it("cues: kept when the words stay, re-timed (and counted) when they go; the confirm says so", () => {
    const kept = applySceneOp(board(), { kind: "edit", sceneId: "s2", narration: "Sunlight looks white, honestly, but it hides every colour." });
    expect(kept.ok && kept.changes.retimed).toEqual([]);
    expect(kept.ok && needsConfirm(kept.changes)).toBe(false);
    const gone = applySceneOp(board(), { kind: "edit", sceneId: "s2", narration: "Light from the sun hides every colour of the rainbow." });
    expect(gone.ok && gone.changes.retimed).toEqual([{ sceneId: "s2", count: 1 }]);
    expect(gone.ok && needsConfirm(gone.changes)).toBe(true);
    expect(gone.ok && describeChanges(gone.changes, gone.storyboard)[0]).toMatch(/in scene 2 will appear at a different moment/);
  });

  it("re-anchors to the closest word, or to the element's own words, else drops (even spacing)", () => {
    expect(findAnchor("colours", "every colour of the rainbow")).toEqual({ anchor: "colour", exact: false });
    expect(findAnchor("purple", "every colour of the rainbow")).toBeNull();
    const before = scene("x");
    const r = rebuildCues(before, { ...before, narration: "Light: white light holds every colour." });
    expect(r.cues).toEqual([{ target: "k1", anchor: "white" }]);
    const changed = rebuildCues(before, { ...before, type: "Flowchart", props: { nodes: [{ id: "n1", label: "rainbow" }, { id: "n2", label: "prism" }] } });
    expect(changed.cues).toEqual([{ target: "n1", anchor: "rainbow" }]);
    expect(changed.report.retimed).toBeGreaterThan(0);
  });

  it("changing the type: the new type's props, a summary saying so, previews get the new type", () => {
    const r = applySceneOp(board(), { kind: "edit", sceneId: "s3", type: "Flowchart", props: { nodes: [{ id: "n1", label: "Sun" }, { id: "n2", label: "Eye" }] } });
    expect(r.ok && r.storyboard.scenes[2]).toMatchObject({ type: "Flowchart", props: { nodes: [{ id: "n1", label: "Sun" }, { id: "n2", label: "Eye" }] } });
    expect(r.ok && r.summary).toBe("Changed scene 3 to Flowchart");
  });

  it("headline edits keep accent and anchor; a gone anchor is dropped and counted", () => {
    const sb = board();
    sb.scenes[1].beats = [{ headline: "One", accent: "orange" }, { headline: "Two", accent: "green", anchor: "rainbow" }];
    const r = applySceneOp(sb, { kind: "edit", sceneId: "s2", beats: [{ headline: "Uno" }, { headline: "Dos" }], narration: "Sunlight looks white but it hides every colour." });
    expect(r.ok && r.storyboard.scenes[1].beats).toEqual([{ headline: "Uno", accent: "orange" }, { headline: "Dos", accent: "green" }]);
    expect(r.ok && r.changes.retimed[0].count).toBe(1);
  });

  it("an edit that changes nothing is a no-op; a too-long narration is refused", () => {
    expect(applySceneOp(board(), { kind: "edit", sceneId: "s2", narration: board().scenes[1].narration }).ok && (applySceneOp(board(), { kind: "edit", sceneId: "s2" }) as any).noop).toBe(true);
    const long = applySceneOp(board(), { kind: "edit", sceneId: "s2", narration: "word ".repeat(81) });
    expect(!long.ok && long.problems[0]).toMatchObject({ field: "narration" });
    expect(applySceneOp(board(), { kind: "edit", sceneId: "nope" })).toMatchObject({ ok: false, status: "not_found" });
  });
});

describe("list item ids (cue targets and render keys)", () => {
  it("a missing or repeated item id is refused with its field path; the page's own ids pass", () => {
    const narration = "Light has steps worth remembering for the exam today.";
    const items = (ids: unknown[]) => ({ items: ids.map((id, i) => ({ id, text: `Step ${i + 1}` })) });
    expect(sceneProblems({ narration, type: "BulletSteps", props: items(["i1", "i2"]), beats: [] })).toEqual([]);
    expect(sceneProblems({ narration, type: "BulletSteps", props: items(["i1", "i1"]), beats: [] })).toContainEqual({ field: "props.items[1].id", issue: '"i1" is used twice' });
    expect(sceneProblems({ narration, type: "BulletSteps", props: items(["i1", " "]), beats: [] })).toContainEqual({ field: "props.items[1].id", issue: "is missing" });
    const res = applySceneOp(board(), { kind: "edit", sceneId: "s2", type: "BulletSteps", props: items(["x", "x"]) });
    expect(res.ok).toBe(false);
  });
});

describe("delete", () => {
  it("any scene down to 1; deleting the hook or the closing recap warns; chapters and diagram steps reflow", () => {
    let sb = board();
    const hook = applySceneOp(sb, { kind: "delete", sceneId: "s1" });
    expect(hook.ok && hook.changes.warnings).toEqual(["The video will be left without a hook."]);
    expect(hook.ok && hook.changedSceneIds).toEqual([]);
    const recap = applySceneOp(sb, { kind: "delete", sceneId: "s6" });
    expect(recap.ok && recap.changes.warnings).toEqual(["The video will be left without a recap."]);
    // The hook moved down the list still warns when deleted (QA, F3.6).
    const moved = applySceneOp(sb, { kind: "move", sceneId: "s1", afterSceneId: "s3" });
    const movedHook = moved.ok ? applySceneOp(moved.storyboard, { kind: "delete", sceneId: "s1" }) : null;
    expect(movedHook?.ok && movedHook.changes.warnings).toEqual(["The video will be left without a hook."]);
    // Chapter 1 emptied: chapter 2 becomes 1; diagram steps 1, 2.
    sb = applySceneOp(sb, { kind: "delete", sceneId: "s2" }).ok ? (applySceneOp(sb, { kind: "delete", sceneId: "s2" }) as any).storyboard : sb;
    const r = applySceneOp(sb, { kind: "delete", sceneId: "s3" });
    expect(r.ok && r.storyboard.scenes.map((s) => s.beat.chapter?.index ?? null)).toEqual([null, 1, 1, null]);
    expect(r.ok && r.storyboard.scenes[1].beat.diagram).toEqual({ id: "main", step: 1 });
    expect(r.ok && r.changes.renumbered).toBe(true);
    let one: Storyboard = board();
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) one = (applySceneOp(one, { kind: "delete", sceneId: id }) as any).storyboard;
    expect(one.scenes).toHaveLength(1);
    expect(applySceneOp(one, { kind: "delete", sceneId: "s6" })).toMatchObject({ ok: false, problems: [{ issue: "the last scene can't be deleted" }] });
  });
});

describe("move", () => {
  it("a moved scene joins the chapter above it; the confirm says so; ids stay", () => {
    const r = applySceneOp(board(), { kind: "move", sceneId: "s5", afterSceneId: "s2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.storyboard.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s5", "s3", "s4", "s6"]);
    expect(r.storyboard.scenes.map((s) => s.beat.chapter?.index ?? null)).toEqual([null, 1, 1, 1, 2, null]);
    expect(r.changes.chapterMoves).toEqual([{ sceneId: "s5", from: 2, to: 1 }]);
    expect(describeChanges(r.changes, r.storyboard)).toContain("Scene 3 moves from chapter 2 to chapter 1.");
    // With the storyboard before the move, the scene keeps the number the user knows (QA, F3.6).
    expect(describeChanges(r.changes, r.storyboard, board())).toContain("Scene 5 (now 3) moves from chapter 2 to chapter 1.");
    expect(r.changedSceneIds).toEqual(["s5", "s3", "s4"]);
    expect(r.summary).toBe("Moved scene 5 to position 3");
  });

  it("the hook and the recap can move too; moving to the top uses the chapter below; diagram steps follow the order", () => {
    const top = applySceneOp(board(), { kind: "move", sceneId: "s3", afterSceneId: null });
    expect(top.ok && top.storyboard.scenes[0]).toMatchObject({ id: "s3", beat: { chapter: { index: 1 } } });
    const hook = applySceneOp(board(), { kind: "move", sceneId: "s1", afterSceneId: "s6" });
    expect(hook.ok && hook.storyboard.scenes.at(-1)!.id).toBe("s1");
    expect(hook.ok && hook.storyboard.scenes.at(-1)!.beat.chapter).toBeUndefined();
    const steps = applySceneOp(board(), { kind: "move", sceneId: "s4", afterSceneId: "s1" });
    expect(steps.ok && steps.storyboard.scenes.filter((s) => s.beat.diagram).map((s) => [s.id, s.beat.diagram!.step])).toEqual([
      ["s4", 1],
      ["s2", 2],
      ["s3", 3],
    ]);
  });

  it("a move to the same place is a no-op; an unknown target is refused", () => {
    expect(applySceneOp(board(), { kind: "move", sceneId: "s3", afterSceneId: "s2" })).toMatchObject({ ok: true, noop: true });
    expect(applySceneOp(board(), { kind: "move", sceneId: "s3", afterSceneId: "x" })).toMatchObject({ ok: false, status: "invalid" });
  });
});

describe("reflowBeats and measure", () => {
  it("renumbers chapters by runs and leaves chapter-less scenes alone", () => {
    const sb = board();
    const out = reflowBeats([sb.scenes[0], sb.scenes[3], sb.scenes[1], sb.scenes[5]]);
    expect(out.map((s) => s.beat.chapter?.index ?? null)).toEqual([null, 1, 2, null]);
  });

  it("recomputes words and the estimated length", () => {
    const m = measureStoryboard(board());
    expect(m.wordCount).toBe(6 * 13);
    expect(m.estimatedDurationSec).toBe(Math.round(((6 * 13) / 150) * 60 + 3));
  });
});
