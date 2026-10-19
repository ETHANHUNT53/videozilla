import { GoogleGenAI } from "@google/genai";
import { AiBlockedError, type Backend } from "./backend";

/**
 * Finish reasons that mean Gemini's safety systems stopped the answer. RECITATION isn't one: it means the reply
 * started to repeat existing text (a famous poem, song lyrics), so it's an unusable reply that gets one more try with
 * "use your own words", never a safety refusal.
 */
const BLOCKED_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

/** Why Gemini blocked this response, or null when it wasn't blocked. */
function blockReason(res: { promptFeedback?: { blockReason?: unknown }; candidates?: { finishReason?: unknown }[] }): string | null {
  const prompt = res.promptFeedback?.blockReason;
  if (prompt) return `prompt ${String(prompt)}`;
  const finish = res.candidates?.[0]?.finishReason;
  return typeof finish === "string" && BLOCKED_FINISH.has(finish) ? `reply ${finish}` : null;
}

/**
 * Time kept back for a Gemini fallback while the main model runs. Measured 2026-10-17 on the free tier, for 5 Hindi
 * idea cards: gemini-3.8-flash 9–12 s even with thinking at LOW (15 s at its default), gemini-3.5-flash-lite ~2 s.
 */
const GEMINI_RESERVE_MS = 4_000;

/**
 * Per-model generation settings. gemini-3.8-flash thinks at length by default (≈1,100 thought tokens, +5 s here);
 * these short creative tasks don't need it. Models not listed get the API defaults (some reject thinking settings).
 */
const MODEL_CONFIG: Record<string, Record<string, unknown>> = {
  "gemini-3.8-flash": { thinkingConfig: { thinkingLevel: "LOW" } },
};

/** One Gemini model. Its errors are thrown as the SDK gives them; `generateJson` sorts them by message. */
export function geminiBackend(apiKey: string, model: string): Backend {
  const ai = new GoogleGenAI({ apiKey });
  return {
    provider: "gemini",
    model,
    reserveMs: GEMINI_RESERVE_MS,
    // Measured 2026-10-17: gemini-3.8-flash 9–12 s for 5 Hindi idea cards, the flash-lite models about 2 s.
    typicalMs: /lite/.test(model) ? 3_000 : 9_000,
    async complete({ system, turns, temperature, signal }) {
      const res = await ai.models.generateContent({
        model,
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        config: { systemInstruction: system, responseMimeType: "application/json", temperature, ...MODEL_CONFIG[model], abortSignal: signal },
      });
      const inputTokens = res.usageMetadata?.promptTokenCount ?? null;
      const blocked = blockReason(res);
      if (blocked) throw new AiBlockedError(blocked, inputTokens);
      if (res.candidates?.[0]?.finishReason === "RECITATION") return { text: "", inputTokens, outputTokens: null, recited: true };
      return { text: res.text ?? "", inputTokens, outputTokens: res.usageMetadata?.candidatesTokenCount ?? null };
    },
  };
}
