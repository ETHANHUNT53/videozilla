import { writeFile } from "node:fs/promises";
import { tokenize } from "@videozilla/pipeline";
import type { SynthOptions, SynthResult, TTSProvider, WordTiming } from "./types";

const WPM = { en: 150, hi: 140 } as const;
const SAMPLE_RATE = 24_000;

/** A silent 16-bit mono WAV of the given length. */
function silentWav(durationMs: number): Buffer {
  const samples = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

/**
 * No-key stand-in for a real voice: silent audio with word timings estimated from speaking rate.
 * Lets the whole pipeline (sync, captions, render) be tested before API keys exist.
 */
export function createMockTTS(): TTSProvider {
  return {
    name: "mock",
    async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
      const tokens = tokenize(text);
      // MOCK_WPM imitates a slower or faster real voice when testing duration fitting.
      const wpm = Number(process.env.MOCK_WPM) || WPM[opts.language];
      const msPerWord = 60_000 / (wpm * (opts.speed ?? 1));
      const totalChars = tokens.reduce((n, t) => n + t.length, 0) || 1;
      const speechMs = tokens.length * msPerWord;

      const words: WordTiming[] = [];
      let t = 0;
      for (const tok of tokens) {
        const len = (tok.length / totalChars) * speechMs;
        const pause = /[,.!?।]$/.test(tok) ? 180 : 0;
        words.push({ text: tok, startMs: t, endMs: t + len });
        t += len + pause;
      }
      const durationMs = t + 100;
      const audioPath = `${opts.outPathNoExt}.wav`;
      await writeFile(audioPath, silentWav(durationMs));
      return { audioPath, durationMs, words, timingSource: "estimated" };
    },
  };
}
