import { interpolate, useCurrentFrame } from "remotion";
import type { CaptionPhrase, Language } from "../schema";
import { SAFE, type VideoStyle } from "./styles";

/** Reels-style captions in the safe caption band, with the spoken word highlighted. */
export const Captions: React.FC<{ captions: CaptionPhrase[]; style: VideoStyle; language: Language }> = ({ captions, style, language }) => {
  const frame = useCurrentFrame();
  const phrase = captions.find((p) => frame >= p.from && frame < p.to);
  if (!phrase) return null;

  const pop = interpolate(frame - phrase.from, [0, 5], [0.85, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s = style.captions;
  const stroke = s.stroke;
  const outline = `0 0 8px ${stroke}, 0 0 4px ${stroke}, 3px 3px 0 ${stroke}, -3px -3px 0 ${stroke}, 3px -3px 0 ${stroke}, -3px 3px 0 ${stroke}`;

  return (
    <div
      style={{
        position: "absolute",
        top: SAFE.captionTop,
        height: SAFE.captionBottom - SAFE.captionTop,
        left: 80,
        right: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `scale(${pop})`,
          textAlign: "center",
          fontSize: language === "hi" ? 58 : 60,
          fontWeight: 800,
          lineHeight: language === "hi" ? 1.45 : 1.3,
          textWrap: "balance",
          color: s.text,
          textShadow: outline,
        }}
      >
        {phrase.words.map((w, i) => {
          const active = frame >= w.from && frame < (phrase.words[i + 1]?.from ?? phrase.to);
          return (
            <span key={i}>
              <span
                style={{
                  padding: "0 10px",
                  borderRadius: 14,
                  background: active ? s.activeBg : "transparent",
                  color: active ? s.active : s.text,
                  textShadow: active ? "none" : outline,
                }}
              >
                {w.text}
              </span>{" "}
            </span>
          );
        })}
      </div>
    </div>
  );
};
