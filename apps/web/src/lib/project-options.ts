import type { ProjectStatus } from "./status";

/**
 * Labels and choices for a project's settings, and which step of Idea → Storyboard → Video a status belongs to.
 * Safe to import from client components (no server code); a test checks the values match the stored enums in
 * packages/db.
 */

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिंदी (Hindi)" },
] as const;

export const LENGTH_OPTIONS = [
  { value: 60, label: "~60 seconds" },
  { value: 90, label: "~90 seconds" },
] as const;

export const AUDIENCE_OPTIONS = [
  { value: "kids", label: "Kids (6–12)" },
  { value: "students", label: "School students" },
  { value: "college", label: "College" },
  { value: "general", label: "General" },
] as const;

export const BOARD_OPTIONS = [
  { value: null, label: "None" },
  { value: "cbse", label: "CBSE" },
  { value: "icse", label: "ICSE" },
  { value: "state", label: "State board" },
  { value: "jee", label: "JEE" },
  { value: "neet", label: "NEET" },
  { value: "upsc", label: "UPSC" },
] as const;

/** Only the two approved voices exist; voice ids are never shown (API Design §13.1). */
export const VOICE_OPTIONS = [
  { value: "female", label: "Female voice" },
  { value: "male", label: "Male voice" },
] as const;

export const STYLE_LABELS: Record<string, string> = { midnight: "Midnight" };

export function labelOf<V>(options: readonly { value: V; label: string }[], value: V): string {
  return options.find((o) => o.value === value)?.label ?? String(value);
}

export const STEPS = [
  { id: "idea", n: "01", label: "Idea", hint: "// topic & brief" },
  { id: "storyboard", n: "02", label: "Storyboard", hint: "// scenes & audio" },
  { id: "video", n: "03", label: "Video", hint: "// render & post" },
] as const;

/**
 * The step a project is on (0 = Idea, 1 = Storyboard, 2 = Video). A project that needs attention is on the step where
 * it failed (`attention.kind`): a failed storyboard generation is still the Storyboard step, not Video.
 */
export function stepIndex(status: ProjectStatus, attentionKind?: "storyboard" | "build" | "render" | "publish" | null): 0 | 1 | 2 {
  if (status === "idea_draft") return 0;
  if (status === "storyboard_generating" || status === "storyboard_ready") return 1;
  if (status === "needs_attention" && attentionKind === "storyboard") return 1;
  return 2;
}
