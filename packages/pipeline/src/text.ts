/** Splits narration into spoken words (keeps Devanagari combining marks together). */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => normalizeToken(w).length > 0);
}

/** Lowercases and strips punctuation (including the Hindi danda) for matching. */
export function normalizeToken(word: string): string {
  return word
    .normalize("NFC")
    .toLowerCase()
    .replace(/[।॥.,!?;:'"“”‘’()\[\]{}…\-–—/\\*_~`|<>]/g, "")
    .trim();
}

/** Similarity in 0..1 based on Levenshtein distance. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

/** Makes narration easier for TTS to read; captions keep the original text. */
export function prepareForSpeech(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
