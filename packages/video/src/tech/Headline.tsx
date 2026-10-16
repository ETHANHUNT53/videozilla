import { interpolate, useCurrentFrame } from "remotion";
import type { HeadlineBeat, Language } from "@videozilla/schema";
import { fitFontSize } from "../anim";
import { techMono, techSans } from "../fonts";
import { TECH_HEADLINE, type VideoStyle } from "../styles";

const BLUR_IN = 12;
const BLUR_OUT = 8;
const TYPE_FRAMES_PER_CHAR = 1.4;

/** Splits "Only *50* online" into plain and accented runs. */
export function parseAccent(text: string): { text: string; accent: boolean }[] {
  return text
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith("*") && part.endsWith("*") ? { text: part.slice(1, -1), accent: true } : { text: part, accent: false }));
}

const accentColor = (style: VideoStyle, name: string) => style.accents[name as keyof VideoStyle["accents"]] ?? style.accents.cyan;

/** Top-of-screen headline that swaps with a blur as each beat arrives. */
export const HeadlineLayer: React.FC<{ headlines: HeadlineBeat[]; style: VideoStyle; language: Language }> = ({ headlines, style, language }) => {
  const frame = useCurrentFrame();
  const idx = headlines.findIndex((h) => frame >= h.from && frame < h.to);
  if (idx < 0) return null;
  const beat = headlines[idx];
  const next = headlines[idx + 1];

  const inP = interpolate(frame, [beat.from, beat.from + BLUR_IN], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const leaving = next && next.text !== beat.text;
  const outP = leaving ? interpolate(frame, [beat.to - BLUR_OUT, beat.to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const blur = (1 - inP) * 18 + outP * 14;
  const opacity = Math.min(inP, 1 - outP);

  const plain = beat.text.replace(/\*/g, "");
  const size = fitFontSize(plain, TECH_HEADLINE.headlineMaxWidth, 2, language === "hi" ? 84 : 92, 60);
  const color = accentColor(style, beat.accent);

  return (
    <>
      <Eyebrow headlines={headlines} idx={idx} style={style} />
      <div
        style={{
          position: "absolute",
          top: TECH_HEADLINE.headlineTop,
          left: (1080 - TECH_HEADLINE.headlineMaxWidth) / 2,
          width: TECH_HEADLINE.headlineMaxWidth,
          textAlign: "center",
          fontFamily: techSans,
          fontWeight: 600,
          fontSize: size,
          lineHeight: language === "hi" ? 1.3 : 1.08,
          letterSpacing: language === "hi" ? 0 : -1.5,
          color: style.colors.text,
          filter: `blur(${blur}px)`,
          opacity,
          transform: `translateY(${(1 - inP) * 12}px)`,
          textWrap: "balance",
        }}
      >
        {parseAccent(beat.text).map((run, i) => (
          <span key={i} style={run.accent ? { color, textShadow: `0 0 28px ${color}55` } : undefined}>
            {run.text}
          </span>
        ))}
      </div>
    </>
  );
};

/** "// section" in small monospace, typed out whenever the section changes, with a blinking block cursor. */
const Eyebrow: React.FC<{ headlines: HeadlineBeat[]; idx: number; style: VideoStyle }> = ({ headlines, idx, style }) => {
  const frame = useCurrentFrame();
  const section = headlines[idx].section;
  if (!section) return null;
  let start = idx;
  while (start > 0 && headlines[start - 1].section === section) start--;
  const typed = Math.floor((frame - headlines[start].from) / TYPE_FRAMES_PER_CHAR);
  const shown = section.slice(0, Math.max(0, typed));
  const cursorOn = Math.floor(frame / 15) % 2 === 0;
  const color = accentColor(style, headlines[idx].accent);

  return (
    <div
      style={{
        position: "absolute",
        top: TECH_HEADLINE.eyebrowY,
        left: 0,
        right: 0,
        textAlign: "center",
        fontFamily: techMono,
        fontSize: 30,
        letterSpacing: 1,
        color: style.colors.muted,
        whiteSpace: "pre",
      }}
    >
      <span style={{ color }}>// </span>
      {shown}
      <span style={{ display: "inline-block", width: 15, height: 30, marginLeft: 4, verticalAlign: -4, background: cursorOn ? style.colors.text : "transparent" }} />
    </div>
  );
};
