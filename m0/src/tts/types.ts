import type { Language } from "../schema.js";

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SynthResult {
  audioPath: string;
  durationMs: number;
  words: WordTiming[];
  timingSource: "tts" | "forced_alignment" | "estimated";
}

export interface SynthOptions {
  language: Language;
  voice?: string;
  gender?: "female" | "male";
  /** Speaking speed multiplier (ElevenLabs allows 0.7–1.2); used to fit the video to its target length. */
  speed?: number;
  /** Output file path without extension; the provider adds .wav or .mp3. */
  outPathNoExt: string;
  /** Narration of the neighbouring scenes, so per-scene audio sounds continuous. */
  previousText?: string;
  nextText?: string;
}

export interface TTSProvider {
  name: string;
  synthesize(text: string, opts: SynthOptions): Promise<SynthResult>;
}
