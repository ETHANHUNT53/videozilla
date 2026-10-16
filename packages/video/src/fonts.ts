import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { loadFont as loadDevanagari } from "@remotion/google-fonts/NotoSansDevanagari";

// Poppins covers both Latin and Devanagari, so English and Hindi share one typeface in the card styles.
export const { fontFamily } = loadPoppins("normal", {
  weights: ["500", "600", "700", "800"],
  subsets: ["latin", "devanagari"],
});

const geist = loadGeist("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const geistMono = loadGeistMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
const devanagari = loadDevanagari("normal", { weights: ["400", "500", "600", "700"], subsets: ["devanagari"] });

/** Tech look: Geist for Latin, falling back to Noto Sans Devanagari for Hindi glyphs. */
export const techSans = `${geist.fontFamily}, ${devanagari.fontFamily}, sans-serif`;
export const techMono = `${geistMono.fontFamily}, ${devanagari.fontFamily}, monospace`;
