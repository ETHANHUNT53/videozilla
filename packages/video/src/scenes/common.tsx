import { AbsoluteFill } from "remotion";
import { useVideoStyle } from "../context";
import { SAFE, safeAreaFor, type VideoStyle } from "../styles";

export interface SceneComponentProps {
  props: any;
  cue: Record<string, number>;
  style: VideoStyle;
  duration: number;
}

/** The safe content area of a Reel (depends on the look: below the headline in tech, below the top UI in card). */
export const Stage: React.FC<{ children: React.ReactNode; justify?: React.CSSProperties["justifyContent"]; gap?: number }> = ({
  children,
  justify = "center",
  gap = 36,
}) => {
  const area = safeAreaFor(useVideoStyle());
  return (
    <AbsoluteFill
      style={{
        top: area.contentTop,
        height: area.contentBottom - area.contentTop,
        left: area.sideX,
        right: area.sideX,
        width: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: justify,
        gap,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const CONTENT_WIDTH = 1080 - SAFE.sideX * 2;
