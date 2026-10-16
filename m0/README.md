# Videozilla M0: technical proof

A command-line prototype of the core pipeline from the [PRD](../docs/PRD.md):

```
topic → Gemini storyboard (JSON) → validator → voiceover with word timings → sync + captions → Remotion → MP4
```

## Setup (once)

1. Install packages:
   ```bash
   npm install
   ```
2. Open `.env` (already created from `.env.example`) and paste your own keys. Never share or commit `.env`.
   - `GEMINI_API_KEY`: free from Google AI Studio.
   - `ELEVENLABS_API_KEY`: the default voice provider (model `eleven_multilingual_v2`, speaks English and Hindi).
   - Optional: `ELEVENLABS_VOICE_EN` / `ELEVENLABS_VOICE_HI` voice IDs. To see the voices on your account:
     ```bash
     npm run make -- --list-voices
     ```
   - Optional: Azure keys, only if you want to compare with `--tts azure`.

**ElevenLabs credits:** `eleven_multilingual_v2` uses about 1 credit per character, so a 60-second video costs about 700–900 credits. The free plan (10,000 credits/month) covers roughly 10 test videos, but it doesn't include a commercial license.

## Make a video

Full pipeline (needs Gemini and ElevenLabs keys):
```bash
npm run make -- --topic "Why do we have seasons?" --lang en
```

Hindi:
```bash
npm run make -- --topic "प्रकाश संश्लेषण कैसे होता है" --lang hi
```

Without any keys (sample storyboard, silent mock voice):
```bash
npm run make -- --storyboard fixtures/sky-blue.en.json --tts mock
```

Re-render an existing run without calling Gemini or ElevenLabs again (no credits used):
```bash
npm run render-run -- out/<run-id>
```

Quick look at a few still frames per scene instead of the full video:
```bash
npm run make -- --storyboard fixtures/photosynthesis-illustrated.hi.json --tts mock --lang hi --stills
```

Useful options: `--gender male|female` (picks one of your two voices — the only voices used), `--length 90`, `--style bold-dark`, `--tts azure`, `--voice <voice id>`, `--audience "class 10 CBSE students"`, `--no-render`.

Each run writes to `out/<run-id>/`:

| File | What it is |
|---|---|
| `video.mp4` | The final 1080×1920 video |
| `cover.png` | Cover image from the hook scene |
| `storyboard.json` | Validated scene plan (narration, scene types, cues) |
| `timeline.json` | Frame-exact plan used by the renderer |
| `report.json` | Timings, validator repairs, cue sync stats, render time |

## Preview in Remotion Studio

```bash
npm run studio
```
Opens a browser editor with a small sample timeline.

## What's inside

| Path | Purpose |
|---|---|
| `src/llm/` | Gemini prompt and call (retries with validation errors) |
| `src/validate.ts` | Repairs or replaces invalid scenes, checks cues and word budget |
| `src/tts/` | Azure, ElevenLabs (+ forced alignment) and mock voice adapters |
| `src/timeline.ts` | Scene timing, cue → frame matching (exact/fuzzy/fallback), caption phrases |
| `src/video/` | Remotion composition, 7 scene types, 2 styles, captions |
| `fixtures/` | Hand-written English and Hindi storyboards |

## Look

The default style is **midnight**, a dark tech-explainer look inspired by the reference reel:
- a near-black persistent world with a perspective dot floor and gentle camera moves between scenes;
- a small `// section` eyebrow with a typing cursor, and a white headline whose key words are wrapped in `*asterisks*` in the storyboard and drawn in an accent colour (cyan = normal, orange = problem, violet = system, green = growth);
- headlines change per beat with a blur transition, with no word-by-word captions;
- glowing line-art objects, HUD chips, system boxes, and a **UnitGrid** scene (many units lighting up or dimming with a live counter).

The earlier looks are still available with `--style clean-light` or `--style bold-dark`. They show captions instead of headlines.

## M0 checklist

- [x] Pipeline runs end to end with the mock voice (English + Hindi)
- [x] 8 scene types (including animated **Illustration** scenes), 2 styles, Devanagari rendering, safe zones, word-highlight captions
- [x] Illustration library: 23 animated objects (sun, plant, tree, cloud, rain, ocean, person, factory, atom, molecule…) + any Lucide icon, with beams, particles and arrows between them
- [x] Real run: Gemini + ElevenLabs, Hindi (photosynthesis) and English (water cycle), all cues synced
- [ ] Your own ElevenLabs voices are the only voices used; they need a paid ElevenLabs plan (no fallback voice)
- [x] Duration fitting: speaking speed chosen from each voice's learned rate (cached in `.cache/voice-stats.json`), one re-record if the video misses its 60/90 s window; Gemini also gets one correction if the script misses its word budget
- [ ] Real Gemini storyboards: check quality, repair rate, word budget
- [ ] Real ElevenLabs voice: check cue sync accuracy (target ±120 ms) in English and Hindi
- [ ] Listening test: pick the best English and Hindi ElevenLabs voices
- [ ] Record render time per 90 s video on this PC
