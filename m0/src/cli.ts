import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { generateStoryboard } from "@videozilla/ai";
import { buildTimeline, prepareForSpeech, validateStoryboard, type SceneAudio } from "@videozilla/pipeline";
import { correctedSpeed, plannedSpeed, SCENE_PADDING_SEC, VoiceStats } from "@videozilla/pipeline/fit";
import { RawStoryboard, type Language } from "@videozilla/schema";
import { createElevenLabsTTS, createMockTTS, forcedAlign, listVoices, type SynthResult, type TTSProvider } from "@videozilla/voice";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Remotion entry point of the shared video package. */
const VIDEO_ENTRY = fileURLToPath(import.meta.resolve("@videozilla/video/entry"));
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const HELP = `
Videozilla M0 — topic to synced explainer MP4

  npm run make -- --topic "Why is the sky blue?" --lang en
  npm run make -- --topic "प्रकाश संश्लेषण" --lang hi --gender male
  npm run make -- --storyboard fixtures/sky-blue.en.json --tts mock

Options
  --topic <text>        Topic for Gemini to plan (needs GEMINI_API_KEY)
  --storyboard <file>   Use an existing storyboard JSON instead of Gemini
  --lang en|hi          Video language (default en)
  --length 60|90        Target length in seconds (default 60)
  --audience <text>     Audience description (default "school students in India")
  --tts elevenlabs|mock  Voice provider (default elevenlabs with your approved voices; mock = silent test, no key needed)
  --list-voices         Show the ElevenLabs voices on your account, then exit
  --gender female|male  Which of your configured voices to use (default female)
  --voice <id>          Explicit voice name / ID (overrides --gender)
  --style midnight|clean-light|bold-dark (default midnight)
  --no-render           Stop after writing timeline.json
  --stills              Render two preview stills per scene instead of the video (fast)
  --scenes s3,s4        With --stills, only these scenes
`;

function slug(s: string): string {
  const ascii = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (ascii || "video").slice(0, 40);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts) {
        console.warn(`  ${label} failed (attempt ${i}), retrying: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
  }
  throw last;
}

function pickTTS(name: string): TTSProvider {
  if (name === "azure") throw new Error("Azure voices were removed: only your approved ElevenLabs voices are used (use --tts mock for a silent test).");
  if (name === "elevenlabs") return createElevenLabsTTS();
  if (name === "mock") return createMockTTS();
  throw new Error(`Unknown --tts "${name}" (use elevenlabs or mock)`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      topic: { type: "string" },
      storyboard: { type: "string" },
      lang: { type: "string", default: "en" },
      length: { type: "string", default: "60" },
      audience: { type: "string", default: "school students in India" },
      tts: { type: "string", default: "elevenlabs" },
      voice: { type: "string" },
      gender: { type: "string", default: "female" },
      style: { type: "string", default: "midnight" },
      "no-render": { type: "boolean", default: false },
      stills: { type: "boolean", default: false },
      scenes: { type: "string" },
      "list-voices": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values["list-voices"]) {
    const voices = await listVoices();
    console.log(`\n${voices.length} ElevenLabs voices on your account:\n`);
    for (const v of voices) {
      const l = v.labels ?? {};
      const tags = [l.gender, l.age, l.accent, l.language, l.use_case ?? l["use case"]].filter(Boolean).join(", ");
      console.log(`  ${v.voice_id}  ${v.name.padEnd(22)} ${tags}`);
    }
    console.log(`\nPut your picks in m0/.env as ELEVENLABS_VOICE_EN and ELEVENLABS_VOICE_HI, or pass --voice <id>.\n`);
    return;
  }
  if (values.help || (!values.topic && !values.storyboard)) {
    console.log(HELP);
    return;
  }
  const language = values.lang as Language;
  if (language !== "en" && language !== "hi") throw new Error("--lang must be en or hi");
  const targetSec = Number(values.length) === 90 ? 90 : 60;
  const tts = pickTTS(values.tts!);

  const startedAt = Date.now();
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${slug(values.topic ?? path.basename(values.storyboard!, ".json"))}`;
  const outDir = path.join(ROOT, "out", runId);
  const audioDir = path.join(ROOT, "public", "runs", runId);
  await mkdir(outDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });
  console.log(`\nRun ${runId}`);

  // 1. Storyboard
  let raw: RawStoryboard;
  let llm: { model: string; attempts: number } | null = null;
  if (values.storyboard) {
    console.log(`1/4 Loading storyboard ${values.storyboard}`);
    raw = RawStoryboard.parse(JSON.parse(await readFile(path.resolve(values.storyboard), "utf8")));
  } else {
    console.log(`1/4 Writing script and planning scenes with Gemini…`);
    const t = Date.now();
    const res = await generateStoryboard({ topic: values.topic!, language, targetSec, audience: values.audience! });
    raw = res.raw;
    llm = { model: res.model, attempts: res.attempts };
    console.log(`    done in ${((Date.now() - t) / 1000).toFixed(1)}s (${res.model}, ${res.attempts} attempt(s))`);
    await writeFile(path.join(outDir, "storyboard.raw.json"), JSON.stringify(raw, null, 2));
  }
  const { storyboard, report: validation } = validateStoryboard(raw, language, targetSec);
  await writeFile(path.join(outDir, "storyboard.json"), JSON.stringify(storyboard, null, 2));
  console.log(`    ${storyboard.scenes.length} scenes, ${validation.wordCount} words, ~${validation.estimatedDurationSec}s estimated`);
  for (const r of validation.repairs) console.log(`    repaired: ${r}`);
  for (const w of validation.warnings) console.log(`    warning:  ${w}`);

  // 2. Voiceover
  console.log(`2/4 Recording voiceover with ${tts.name} (${storyboard.scenes.length} scenes)…`);
  const t2 = Date.now();
  // ElevenLabs free and starter plans allow few parallel requests.
  const ttsConcurrency = tts.name === "elevenlabs" ? 2 : 3;
  const gender = values.gender === "male" ? "male" : "female";
  const record = (speed: number) =>
    mapLimit(storyboard.scenes, ttsConcurrency, async (scene, i) => {
      const r = await withRetry(`TTS ${scene.id}`, () =>
        tts.synthesize(prepareForSpeech(scene.narration), {
          language,
          voice: values.voice,
          gender,
          speed,
          outPathNoExt: path.join(audioDir, scene.id),
          previousText: storyboard.scenes[i - 1]?.narration,
          nextText: storyboard.scenes[i + 1]?.narration,
        }),
      );
      if (!r.words.length && process.env.ELEVENLABS_API_KEY) {
        console.log(`    ${scene.id}: no word timings from ${tts.name}, using ElevenLabs forced alignment`);
        return { ...r, words: await forcedAlign(r.audioPath, scene.narration), timingSource: "forced_alignment" as const };
      }
      return r;
    });

  // Duration fitting: pick the speaking speed from this voice's learned rate, re-record once if the video still misses.
  const stats = await VoiceStats.load(ROOT);
  const voiceKey = `${tts.name}:${values.voice ?? gender}:${language}`;
  const sceneCount = storyboard.scenes.length;
  let speed = plannedSpeed(validation.wordCount, sceneCount, stats.wpm(voiceKey, language), targetSec);
  if (speed !== 1) console.log(`    speaking speed ${speed}× to fit ~${targetSec}s`);
  let results: SynthResult[] = await record(speed);
  const videoSec = (rs: SynthResult[]) => rs.reduce((s, r) => s + r.durationMs / 1000, 0) + sceneCount * SCENE_PADDING_SEC;
  const retry = correctedSpeed(videoSec(results), sceneCount, speed, targetSec);
  if (retry !== null) {
    console.log(`    came out at ${videoSec(results).toFixed(1)}s; re-recording at ${retry}×`);
    speed = retry;
    results = await record(speed);
  }
  await stats.record(voiceKey, validation.wordCount, results.reduce((s, r) => s + r.durationMs / 1000, 0), speed);
  console.log(`    done in ${((Date.now() - t2) / 1000).toFixed(1)}s (${videoSec(results).toFixed(1)}s of video at ${speed}×)`);

  // 3. Sync
  console.log(`3/4 Syncing animations and captions to the voice…`);
  const audios: SceneAudio[] = results.map((r) => ({
    audioSrc: `runs/${runId}/${path.basename(r.audioPath)}`,
    durationMs: r.durationMs,
    words: r.words,
  }));
  const { timeline, report: sync } = buildTimeline(storyboard, audios, values.style!);
  await writeFile(path.join(outDir, "timeline.json"), JSON.stringify(timeline, null, 2));
  const c = sync.counts;
  console.log(`    video length ${sync.durationSec}s; cues: ${c.exact} exact, ${c.fuzzy} fuzzy, ${c.proportional} proportional, ${c.default} default`);

  const report = {
    runId,
    topic: values.topic ?? null,
    language,
    targetSec,
    tts: tts.name,
    style: values.style,
    llm,
    validation,
    scenes: storyboard.scenes.map((s, i) => ({
      id: s.id,
      type: s.type,
      words: s.narration.split(/\s+/).length,
      audioMs: Math.round(results[i].durationMs),
      timingSource: results[i].timingSource,
      timedWords: results[i].words.length,
    })),
    sync,
    render: null as null | { file: string; seconds: number; cover: string },
  };

  // 4a. Quick look: a few still frames per scene instead of the full video.
  if (values.stills) {
    console.log(`4/4 Rendering preview stills…`);
    const { bundle } = await import("@remotion/bundler");
    const { renderStill, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await bundle({ entryPoint: VIDEO_ENTRY, publicDir: path.join(ROOT, "public") });
    const inputProps = timeline as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps });
    const only = values.scenes ? new Set(values.scenes.split(",")) : null;
    for (const s of timeline.scenes) {
      if (only && !only.has(s.id)) continue;
      for (const f of [0.45, 0.9]) {
        const frame = s.from + Math.floor(s.durationInFrames * f);
        const output = path.join(outDir, `still-${s.id}-${Math.round(f * 100)}.png`);
        await renderStill({ composition, serveUrl, output, frame, inputProps, scale: 0.4 });
      }
    }
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\nStills written to ${outDir}\n`);
    return;
  }

  // 4. Render
  if (!values["no-render"]) {
    console.log(`4/4 Rendering MP4 (1080x1920, 30 fps)…`);
    const t4 = Date.now();
    const { bundle } = await import("@remotion/bundler");
    const { renderMedia, renderStill, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await bundle({ entryPoint: VIDEO_ENTRY, publicDir: path.join(ROOT, "public") });
    const inputProps = timeline as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps });
    const file = path.join(outDir, "video.mp4");
    let lastPct = -10;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: file,
      inputProps,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          process.stdout.write(`    ${pct}%\n`);
        }
      },
    });
    const cover = path.join(outDir, "cover.png");
    const coverFrame = Math.min(composition.durationInFrames - 1, (timeline.scenes[0]?.cueFrames.subline ?? 40) + 25);
    await renderStill({ composition, serveUrl, output: cover, frame: coverFrame, inputProps });
    report.render = { file, seconds: Math.round((Date.now() - t4) / 1000), cover };
    console.log(`    done in ${report.render.seconds}s`);
  }

  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nFinished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s → ${outDir}\n`);
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
