/**
 * The Instagram caption rules (F3.4, PRD F3-FR4, §17): one place for the page, the API and the AI rewrite, so they
 * always agree. Lengths are counted in characters as Instagram does (a Hindi letter with its matra, or an emoji, is
 * counted per code point, never per UTF-16 unit). The hard limits are Instagram's; 5–15 hashtags is only a hint.
 */

export const SOCIAL_LIMITS = {
  /** Caption + hashtags as posted. */
  postChars: 2200,
  hashtags: 30,
  mentions: 20,
  hashtagChars: 100,
  coverWords: 5,
  coverChars: 40,
  /** The hint range (not enforced). */
  hintMin: 5,
  hintMax: 15,
} as const;

export interface Social {
  caption: string;
  hashtags: string[];
  coverText: string;
}

/** Characters as Instagram counts them (code points). */
export const countChars = (s: string) => Array.from(s).length;

const HASHTAG = /#[\p{L}\p{M}\p{N}_]+/gu;
const MENTION = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]+/gu;

/** "#science", "science", "# sky blue" → "#science" / "#skyblue"; null when nothing usable is left. */
export function normalizeHashtag(raw: string): string | null {
  const body = raw
    .normalize("NFC")
    .replace(/[\s#]+/g, "")
    .replace(/[^\p{L}\p{M}\p{N}_]/gu, "");
  if (!body) return null;
  return `#${Array.from(body).slice(0, SOCIAL_LIMITS.hashtagChars - 1).join("")}`;
}

/** Normalised, without duplicates (ignoring case), in order. */
export function normalizeHashtags(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeHashtag(raw);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** The text that will be posted: the caption, a blank line, then the hashtags. */
export function postedText(s: Pick<Social, "caption" | "hashtags">): string {
  const caption = s.caption.trim();
  const tags = s.hashtags.join(" ");
  return caption && tags ? `${caption}\n\n${tags}` : caption || tags;
}

export function socialCounts(s: Pick<Social, "caption" | "hashtags">) {
  const text = postedText(s);
  return {
    chars: countChars(text),
    hashtags: (text.match(HASHTAG) ?? []).length,
    mentions: (text.match(MENTION) ?? []).length,
  };
}

/** "few" below 5 hashtags, "many" above 15, else null (a hint only). */
export function hashtagHint(count: number): "few" | "many" | null {
  return count < SOCIAL_LIMITS.hintMin ? "few" : count > SOCIAL_LIMITS.hintMax ? "many" : null;
}

export interface SocialProblem {
  field: "caption" | "hashtags" | "coverText";
  issue: string;
}

/** What breaks Instagram's limits (or ours for the cover text); empty when it can be saved. */
export function socialProblems(s: Social): SocialProblem[] {
  const problems: SocialProblem[] = [];
  const { chars, hashtags, mentions } = socialCounts(s);
  if (chars > SOCIAL_LIMITS.postChars) problems.push({ field: "caption", issue: `the caption and hashtags are ${chars} characters; Instagram allows ${SOCIAL_LIMITS.postChars}` });
  if (hashtags > SOCIAL_LIMITS.hashtags) problems.push({ field: "hashtags", issue: `${hashtags} hashtags; Instagram allows ${SOCIAL_LIMITS.hashtags}` });
  if (mentions > SOCIAL_LIMITS.mentions) problems.push({ field: "caption", issue: `${mentions} @mentions; Instagram allows ${SOCIAL_LIMITS.mentions}` });
  const cover = s.coverText.trim();
  if (!cover) problems.push({ field: "coverText", issue: "is empty" });
  else if (/[\r\n]/.test(cover)) problems.push({ field: "coverText", issue: "must be one line" });
  else if (cover.split(/\s+/).length > SOCIAL_LIMITS.coverWords) problems.push({ field: "coverText", issue: `must be at most ${SOCIAL_LIMITS.coverWords} words` });
  else if (countChars(cover) > SOCIAL_LIMITS.coverChars) problems.push({ field: "coverText", issue: `must be at most ${SOCIAL_LIMITS.coverChars} characters` });
  return problems;
}
