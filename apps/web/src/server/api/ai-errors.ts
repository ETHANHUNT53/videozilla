import type { RefusalCategory } from "@videozilla/ai";
import { ApiError } from "./errors";

/** How long to suggest waiting after "the AI is busy" when Gemini gave no time of its own. */
export const BUSY_RETRY_SEC = 30;

/** Our own words for each refusal category: the model's text is never shown (it can be steered or leak the prompt). */
export const REFUSAL_TEXT: Record<RefusalCategory | "blocked", string> = {
  hate: "It targets people or groups with hate or harassment.",
  sexual: "It asks for sexual content.",
  violence: "It glorifies violence.",
  self_harm: "It's about harming yourself.",
  illegal: "It asks how to do something illegal, or how to make something dangerous.",
  dangerous: "It's a dangerous challenge or stunt.",
  misinformation: "It would spread false or misleading claims.",
  private_person: "It's about a real private person.",
  impersonation: "It impersonates a real person or brand.",
  other: "It isn't something we can make an educational video about.",
  blocked: "The AI's safety filters stopped it.",
};

/**
 * `422 UNSAFE_CONTENT` for a refused topic or idea (PRD §21.1): a fixed message, our sentence for the category in
 * `details[0].issue`, and the category itself. `field` names the input the refusal is about.
 */
export function unsafeContent(category: RefusalCategory | "blocked" = "blocked", field: "topic" | "idea" = "topic") {
  return new ApiError("UNSAFE_CONTENT", {
    message: `We can't make a video about that ${field}. Try a different subject.`,
    details: [{ field, issue: REFUSAL_TEXT[category], category }],
  });
}
