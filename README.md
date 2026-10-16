# Videozilla

AI educational explainer reels: topic → script & storyboard → voiceover → synced motion graphics → Instagram. India-first, English + Hindi.

## Repository layout

| Path | What it is |
|---|---|
| [`apps/web`](apps/web) | Next.js web app (auth, library, project flow, API) |
| [`packages/schema`](packages/schema) | Shared types, Zod schemas and constants |
| [`packages/pipeline`](packages/pipeline) | Storyboard validation, timeline + cue sync, captions, duration fitting |
| [`packages/ai`](packages/ai) | Gemini prompts and calls |
| [`packages/voice`](packages/voice) | ElevenLabs voice (approved voices only) + forced alignment |
| [`packages/video`](packages/video) | Remotion video composition, scenes, styles |
| [`m0`](m0) | Command-line tool to make a video end to end (the original proof) |
| [`docs`](docs) | PRD, system / DB / API design, UI reference, [project status](docs/PROJECT_STATUS.md) |

## Getting started

```bash
npm install          # once, from this folder (npm workspaces)
npm run typecheck    # type-check every workspace
npm run db           # local MongoDB for the web app
npm run dev          # web app on http://localhost:3000
```

See [apps/web/README.md](apps/web/README.md) and [m0/README.md](m0/README.md) for details.

## Workflow

- Branches: `dev` for all ongoing work, `main` only for approved milestones.
- Built one small feature at a time; progress is tracked in [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).
