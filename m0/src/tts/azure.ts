import { writeFile } from "node:fs/promises";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { Language } from "../schema.js";
import type { SynthOptions, SynthResult, TTSProvider, WordTiming } from "./types.js";

export const AZURE_DEFAULT_VOICES: Record<Language, string> = {
  en: "en-IN-NeerjaNeural",
  hi: "hi-IN-SwaraNeural",
};

const LOCALES: Record<Language, string> = { en: "en-IN", hi: "hi-IN" };
const TICKS_PER_MS = 10_000;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function createAzureTTS(): TTSProvider {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION missing in m0/.env (see .env.example).");

  return {
    name: "azure",
    async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
      const voice = opts.voice || AZURE_DEFAULT_VOICES[opts.language];
      const config = sdk.SpeechConfig.fromSubscription(key, region);
      config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
      const synthesizer = new sdk.SpeechSynthesizer(config, null as unknown as sdk.AudioConfig);

      const words: WordTiming[] = [];
      synthesizer.wordBoundary = (_s, e) => {
        if (e.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) return;
        const startMs = e.audioOffset / TICKS_PER_MS;
        words.push({ text: e.text, startMs, endMs: startMs + e.duration / TICKS_PER_MS });
      };

      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${LOCALES[opts.language]}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;

      const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ssml,
          (r) => {
            synthesizer.close();
            if (r.reason === sdk.ResultReason.SynthesizingAudioCompleted) resolve(r);
            else reject(new Error(`Azure TTS failed: ${r.errorDetails || sdk.ResultReason[r.reason]}`));
          },
          (err) => {
            synthesizer.close();
            reject(new Error(`Azure TTS error: ${err}`));
          },
        );
      });

      const audioPath = `${opts.outPathNoExt}.wav`;
      await writeFile(audioPath, Buffer.from(result.audioData));
      return {
        audioPath,
        durationMs: result.audioDuration / TICKS_PER_MS,
        words,
        timingSource: "tts",
      };
    },
  };
}
