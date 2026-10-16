import { ACCENT_NAMES, type AccentName } from "@videozilla/schema";

export type Look = "card" | "tech";

export interface VideoStyle {
  id: string;
  /** "tech" = dark headline-beat look (default); "card" = the earlier light/colourful card look. */
  look: Look;
  colors: {
    bg: string;
    bg2: string;
    surface: string;
    primary: string;
    accent: string;
    text: string;
    muted: string;
    onPrimary: string;
  };
  /** Semantic accents (tech look): cyan = normal/good, orange = problem/alert, violet = system/AI, green = growth. */
  accents: Record<AccentName, string>;
  captions: { text: string; stroke: string; active: string; activeBg: string };
  showCaptions: boolean;
  radius: number;
  springDamping: number;
}

export { ACCENT_NAMES, type AccentName };

const TECH_ACCENTS: Record<AccentName, string> = {
  cyan: "#38D9F5",
  orange: "#FF8A3D",
  violet: "#A78BFA",
  green: "#4ADE80",
};

export const STYLES: Record<string, VideoStyle> = {
  midnight: {
    id: "midnight",
    look: "tech",
    colors: {
      bg: "#030407",
      bg2: "#080B12",
      surface: "rgba(255,255,255,0.04)",
      primary: TECH_ACCENTS.cyan,
      accent: TECH_ACCENTS.orange,
      text: "#F3F5F9",
      muted: "#7C8494",
      onPrimary: "#030407",
    },
    accents: TECH_ACCENTS,
    captions: { text: "#FFFFFF", stroke: "#000000", active: "#030407", activeBg: TECH_ACCENTS.cyan },
    showCaptions: false,
    radius: 22,
    springDamping: 16,
  },
  "clean-light": {
    id: "clean-light",
    look: "card",
    colors: {
      bg: "#F7F9FC",
      bg2: "#E8EEF9",
      surface: "#FFFFFF",
      primary: "#2563EB",
      accent: "#F59E0B",
      text: "#0F172A",
      muted: "#475569",
      onPrimary: "#FFFFFF",
    },
    accents: { cyan: "#2563EB", orange: "#F59E0B", violet: "#7C3AED", green: "#16A34A" },
    captions: { text: "#0F172A", stroke: "#FFFFFF", active: "#FFFFFF", activeBg: "#2563EB" },
    showCaptions: true,
    radius: 36,
    springDamping: 14,
  },
  "bold-dark": {
    id: "bold-dark",
    look: "card",
    colors: {
      bg: "#0B1020",
      bg2: "#1B1F3B",
      surface: "#161B33",
      primary: "#22D3EE",
      accent: "#F472B6",
      text: "#F8FAFC",
      muted: "#A5B4CF",
      onPrimary: "#0B1020",
    },
    accents: { cyan: "#22D3EE", orange: "#FB923C", violet: "#A78BFA", green: "#4ADE80" },
    captions: { text: "#FFFFFF", stroke: "#0B1020", active: "#0B1020", activeBg: "#22D3EE" },
    showCaptions: true,
    radius: 28,
    springDamping: 11,
  },
};

export const DEFAULT_STYLE = "midnight";
export const getStyle = (id: string): VideoStyle => STYLES[id] ?? STYLES[DEFAULT_STYLE];

export interface SafeArea {
  contentTop: number;
  contentBottom: number;
  sideX: number;
  captionTop: number;
  captionBottom: number;
}

/** Instagram Reels safe zones for a 1080x1920 frame (PRD §14.4), card look. */
export const SAFE: SafeArea = {
  contentTop: 260,
  contentBottom: 1180,
  sideX: 70,
  captionTop: 1230,
  captionBottom: 1460,
};

/** Tech look: eyebrow + headline sit in the top third; visuals take the middle; the bottom stays dark for Instagram's UI. */
export const TECH_SAFE: SafeArea = {
  contentTop: 640,
  contentBottom: 1480,
  sideX: 70,
  captionTop: 1500,
  captionBottom: 1600,
};

export const TECH_HEADLINE = { eyebrowY: 330, headlineTop: 385, headlineMaxWidth: 940 };

export const safeAreaFor = (style: VideoStyle): SafeArea => (style.look === "tech" ? TECH_SAFE : SAFE);
