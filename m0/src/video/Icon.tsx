import { icons, Sparkles } from "lucide-react";

const toPascal = (name: string) =>
  name
    .trim()
    .replace(/[_\s]+/g, "-")
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join("");

/** Common names the AI uses that Lucide spells differently. */
const ALIASES: Record<string, string> = {
  waves: "audio-waveform",
  wave: "audio-waveform",
  water: "droplet",
  plant: "sprout",
  tree: "trees",
  money: "coins",
  rupee: "indian-rupee",
  science: "flask-conical",
  idea: "lightbulb",
  book: "book-open",
  earth: "earth",
  planet: "earth",
  electricity: "zap",
  energy: "zap",
  fire: "flame",
};

/** Renders a Lucide icon by kebab-case name, falling back to a neutral sparkle. */
export const Icon: React.FC<{ name?: string; size: number; color: string; strokeWidth?: number }> = ({ name, size, color, strokeWidth = 2 }) => {
  const key = name ? ALIASES[name.trim().toLowerCase()] ?? name : undefined;
  const Cmp = (key && (icons as Record<string, React.ComponentType<any>>)[toPascal(key)]) || Sparkles;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} />;
};
