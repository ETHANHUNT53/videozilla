/**
 * F2.6 follow-up: when the video's language or length differs from what its brief was written for, the brief card
 * offers to update the brief ("Regenerate brief in Hindi?", PRD F2). This works out the bar's wording.
 * See docs/features/F2.6-brief-follows-settings.md.
 */

type Language = "en" | "hi";
type Settings = { language: Language; lengthSec: 60 | 90 };

const NAME: Record<Language, string> = { en: "English", hi: "Hindi" };

/** The bar's text and button, or null when the brief matches the video (or doesn't say what it was written for). */
export function briefSettingsChange(writtenFor: { language: Language | null; lengthSec: 60 | 90 | null }, video: Settings): { message: string; action: string; key: string } | null {
  const language = writtenFor.language ?? video.language;
  const lengthSec = writtenFor.lengthSec ?? video.lengthSec;
  const newLanguage = language !== video.language;
  const newLength = lengthSec !== video.lengthSec;
  if (!newLanguage && !newLength) return null;
  const key = `${video.language}-${video.lengthSec}`;
  if (newLanguage && newLength) {
    return {
      message: `This brief is in ${NAME[language]} for about ${lengthSec} seconds; the video is now in ${NAME[video.language]}, ${video.lengthSec} seconds.`,
      action: `Regenerate brief in ${NAME[video.language]} for ${video.lengthSec} seconds`,
      key,
    };
  }
  if (newLanguage) return { message: `This brief is in ${NAME[language]}; the video is now in ${NAME[video.language]}.`, action: `Regenerate brief in ${NAME[video.language]}`, key };
  return { message: `This brief is for about ${lengthSec} seconds; the video is now ${video.lengthSec}.`, action: `Update the brief for ${video.lengthSec} seconds`, key };
}
