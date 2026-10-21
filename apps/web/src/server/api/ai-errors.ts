import { AiBusyError, type RefusalCategory } from "@videozilla/ai";
import { ApiError } from "./errors";

/** How long to suggest waiting after "the AI is busy" when the provider gave no time of its own. */
export const BUSY_RETRY_SEC = 30;

/**
 * `503 AI_BUSY` for an AI call that delivered nothing (busy, too slow, or an unusable reply). When every provider is
 * out of credits it won't be back in a minute, so the message says "later" (same code, so clients behave the same).
 */
export function aiBusy(err: unknown) {
  if (err instanceof AiBusyError && err.unavailable) {
    return new ApiError("AI_BUSY", { message: "AI features are unavailable right now. Please try again later.", retryAfterSec: err.retryAfterSec });
  }
  return new ApiError("AI_BUSY", { retryAfterSec: err instanceof AiBusyError ? err.retryAfterSec : BUSY_RETRY_SEC });
}

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
export function unsafeContent(category: RefusalCategory | "blocked" = "blocked", field: "topic" | "idea" | "notes" | "message" | "caption" = "topic") {
  return new ApiError("UNSAFE_CONTENT", {
    message:
      field === "notes"
        ? "We can't make a video about those notes. Try different notes."
        : field === "message"
          ? "We can't make that change to the video. Try asking for something else."
          : field === "caption"
            ? "We can't write that caption. Try a different instruction."
          : `We can't make a video about that ${field}. Try a different subject.`,
    details: [{ field, issue: REFUSAL_TEXT[category], category }],
  });
}
