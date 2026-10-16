import type { Timeline } from "../schema";

/** Tiny hand-made timeline so `npm run studio` has something to show before a real run. */
export const sampleTimeline: Timeline = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 240,
  language: "en",
  styleId: "midnight",
  title: "Sample",
  headlines: [{ from: 0, to: 110, text: "Why is the sky *blue*?", accent: "cyan", section: "the question" }, { from: 110, to: 240, text: "Light *scatters*", accent: "orange", section: "how it works" }],
  scenes: [
    {
      id: "s1",
      type: "TitleHook",
      role: "hook",
      props: { headline: "Why is the sky BLUE?", subline: "It's not the ocean", icon: "sun" },
      from: 0,
      durationInFrames: 110,
      audioSrc: null,
      cueFrames: { icon: 4, headline: 14, subline: 60 },
    },
    {
      id: "s2",
      type: "Flowchart",
      role: "explain",
      props: {
        nodes: [
          { id: "n1", label: "Sunlight", icon: "sun" },
          { id: "n2", label: "Air molecules", icon: "atom" },
          { id: "n3", label: "Blue scatters", icon: "sparkles" },
        ],
      },
      from: 110,
      durationInFrames: 130,
      audioSrc: null,
      cueFrames: { n1: 8, n2: 40, n3: 75 },
    },
  ],
  captions: [
    { from: 10, to: 100, words: [{ text: "Why", from: 10, to: 30 }, { text: "is", from: 30, to: 40 }, { text: "the", from: 40, to: 50 }, { text: "sky", from: 50, to: 70 }, { text: "blue?", from: 70, to: 100 }] },
  ],
};
