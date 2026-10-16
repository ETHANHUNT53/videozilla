import { GoogleGenAI } from "@google/genai";
import { RawStoryboard, type Language } from "../schema.js";
import { storyboardSystemPrompt, storyboardUserPrompt, WORD_BUDGET } from "./prompt.js";

export interface StoryboardRequest {
  topic: string;
  language: Language;
  targetSec: 60 | 90;
  audience: string;
}

/** Calls Gemini and returns a schema-valid raw storyboard, retrying with the validation errors on failure. */
export async function generateStoryboard(req: StoryboardRequest): Promise<{ raw: RawStoryboard; attempts: number; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Add it to m0/.env (see .env.example).");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const ai = new GoogleGenAI({ apiKey });

  const system = storyboardSystemPrompt(req.language, req.targetSec);
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [
    { role: "user", parts: [{ text: storyboardUserPrompt(req.topic, req.audience) }] },
  ];

  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  let usedModel = model;

  /** Retries busy/rate-limited responses with backoff, then tries the fallback model. */
  const call = async () => {
    const models = fallbackModel && fallbackModel !== model ? [model, fallbackModel] : [model];
    let lastErr: unknown;
    for (const m of models) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model: m,
            contents,
            config: { systemInstruction: system, responseMimeType: "application/json", temperature: 0.5 },
          });
          usedModel = m;
          return res;
        } catch (err) {
          lastErr = err;
          const msg = String((err as Error)?.message ?? err);
          const retryable = /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(msg);
          if (!retryable) throw err;
          const wait = 2000 * 2 ** (attempt - 1);
          console.warn(`    Gemini (${m}) is busy, retrying in ${wait / 1000}s…`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      if (m !== models[models.length - 1]) console.warn(`    Switching to fallback model ${fallbackModel}`);
    }
    throw lastErr;
  };

  let lastError = "";
  let lengthFixes = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await call();
    const text = response.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastError = "Response was not valid JSON.";
      contents.push({ role: "model", parts: [{ text }] }, { role: "user", parts: [{ text: `${lastError} Return only the JSON object.` }] });
      continue;
    }
    const result = RawStoryboard.safeParse(parsed);
    if (result.success) {
      // Length check: a script well outside the word budget gives a video far from 60/90 s, so ask once to fix it.
      const words = result.data.scenes.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
      const [minW, maxW] = WORD_BUDGET[req.language][req.targetSec];
      const offBudget = words < minW * 0.9 || words > maxW * 1.1;
      if (!offBudget || lengthFixes >= 1 || attempt === 3) return { raw: result.data, attempts: attempt, model: usedModel };
      lengthFixes++;
      lastError = `narration is ${words} words`;
      console.warn(`    Script is ${words} words (target ${minW}-${maxW}); asking Gemini to ${words < minW ? "expand" : "tighten"} it…`);
      contents.push(
        { role: "model", parts: [{ text }] },
        {
          role: "user",
          parts: [
            {
              text: `The total narration is ${words} words, but it must be ${minW}-${maxW} words for a ${req.targetSec}-second video. ${
                words < minW ? "Expand it: add depth, an example or another scene" : "Tighten it: shorten sentences or merge scenes"
              }. Keep the same JSON shape, sections, beats and cue rules. Return the full corrected JSON only.`,
            },
          ],
        },
      );
      continue;
    }
    lastError = result.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    contents.push(
      { role: "model", parts: [{ text }] },
      { role: "user", parts: [{ text: `The JSON did not match the required shape: ${lastError}. Fix it and return the full corrected JSON only.` }] },
    );
  }
  throw new Error(`Gemini did not return a valid storyboard after 3 attempts: ${lastError}`);
}
