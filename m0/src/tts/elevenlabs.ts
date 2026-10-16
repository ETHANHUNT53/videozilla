import { readFile, writeFile } from "node:fs/promises";
import type { SynthOptions, SynthResult, TTSProvider, WordTiming } from "./types.js";

const API = "https://api.elevenlabs.io/v1";

function requireKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing in m0/.env (see .env.example).");
  return key;
}

/** Groups ElevenLabs character timings into words. */
function charsToWords(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let current = "";
  let start = 0;
  let end = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (current) words.push({ text: current, startMs: start * 1000, endMs: end * 1000 });
      current = "";
      continue;
    }
    if (!current) start = starts[i];
    current += ch;
    end = ends[i];
  }
  if (current) words.push({ text: current, startMs: start * 1000, endMs: end * 1000 });
  return words;
}

export function createElevenLabsTTS(): TTSProvider {
  const key = requireKey();
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

  return {
    name: "elevenlabs",
    async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
      const voice = approvedVoice(opts.gender ?? "female", opts.voice);

      const request = (voiceId: string) =>
        fetch(`${API}/text-to-speech/${voiceId}/with-timestamps`, {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json" },
          // previous_text / next_text keep tone and pacing consistent across separately synthesized scenes.
          body: JSON.stringify({
            text,
            model_id: model,
            previous_text: opts.previousText || undefined,
            next_text: opts.nextText || undefined,
            voice_settings: opts.speed && opts.speed !== 1 ? { speed: opts.speed } : undefined,
          }),
        });

      const res = await request(voice);
      if (res.status === 402) {
        throw new Error(
          `Your ElevenLabs voice (${voice}) needs a paid ElevenLabs plan to be used through the API. ` +
            `Upgrade to Creator (or add credits) at elevenlabs.io, then run again. Only your configured voices are used, so there is no fallback voice.`,
        );
      }
      if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as {
        audio_base64: string;
        alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
      };

      const audioPath = `${opts.outPathNoExt}.mp3`;
      await writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));

      if (data.alignment?.characters?.length) {
        const a = data.alignment;
        const words = charsToWords(a.characters, a.character_start_times_seconds, a.character_end_times_seconds);
        const durationMs = a.character_end_times_seconds[a.character_end_times_seconds.length - 1] * 1000 + 150;
        return { audioPath, durationMs, words, timingSource: "tts" };
      }

      const words = await forcedAlign(audioPath, text);
      const durationMs = (words[words.length - 1]?.endMs ?? 0) + 150;
      return { audioPath, durationMs, words, timingSource: "forced_alignment" };
    },
  };
}

export interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

/** Voices available to this API key (premade + any added to "My Voices"). */
export async function listVoices(): Promise<ElevenVoice[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": requireKey() } });
  if (!res.ok) throw new Error(`ElevenLabs voice list failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { voices: ElevenVoice[] };
  return data.voices;
}

/**
 * Only the product owner's two voices are allowed (set in .env). No other voice is ever used:
 * an explicit --voice must be one of them, and there is no automatic fallback.
 */
function approvedVoice(gender: "female" | "male", explicit?: string): string {
  const voices = { female: process.env.ELEVENLABS_VOICE_FEMALE, male: process.env.ELEVENLABS_VOICE_MALE };
  if (explicit) {
    if (explicit !== voices.female && explicit !== voices.male) {
      throw new Error(`Voice ${explicit} is not one of the approved voices (ELEVENLABS_VOICE_FEMALE / ELEVENLABS_VOICE_MALE in .env).`);
    }
    return explicit;
  }
  const id = voices[gender];
  if (!id) throw new Error(`Set ELEVENLABS_VOICE_${gender.toUpperCase()} in m0/.env.`);
  return id;
}

/** ElevenLabs Forced Alignment API: audio + known text -> word timings (supports Hindi). */
export async function forcedAlign(audioPath: string, text: string): Promise<WordTiming[]> {
  const key = requireKey();
  const form = new FormData();
  const bytes = await readFile(audioPath);
  const mime = audioPath.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  form.append("file", new Blob([bytes], { type: mime }), audioPath.split(/[\\/]/).pop());
  form.append("text", text);
  const res = await fetch(`${API}/forced-alignment`, { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs forced alignment failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { words: { text: string; start: number; end: number }[] };
  return data.words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => ({ text: w.text.trim(), startMs: w.start * 1000, endMs: w.end * 1000 }));
}
