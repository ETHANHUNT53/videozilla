# Videozilla — Project Status

> **Repository:** https://github.com/ETHANHUNT53/videozilla
> - **`dev`** — all ongoing work; every finished feature or step is committed **and pushed** here together with an update to this document.
> - **`main`** — stable; `dev` is merged into `main` only when you approve a finished milestone.
>
> **How this document works.** The app is built **one small feature at a time**. Every feature has an ID below. When a feature is started, finished, blocked or changed, its row is updated **and** a line is added to the [Change log](#change-log). This document is the single place to see where the project stands.

| | |
|---|---|
| **Last updated** | 2026-10-16 |
| **Current phase** | Feature build — finishing F1.1–F1.4 (sign-in + email) |
| **Next feature** | **F0.2 — Unit tests** for the shared packages (F1.1–F1.4 still waiting on your sign-up test + Google keys) |
| **Blockers** | ElevenLabs paid plan (your two voices need it), Meta App Review (Instagram, later) |

### Status legend

| Icon | Meaning |
|---|---|
| ✅ | Done and verified |
| 🟡 | Built as a draft — works, but must be aligned with the approved design docs before it counts as done |
| 🔵 | In progress |
| ⬜ | Not started |
| ⛔ | Blocked (reason in Notes) |

### Summary

| Area | Done | Draft | Not started | Blocked |
|---|---|---|---|---|
| Planning & design | 8 | 0 | 0 | 0 |
| F0 Foundation | 1 | 0 | 3 (+1 in progress) | 0 |
| F1 Accounts & library | 0 | 7 (+3 in progress) | 4 | 0 |
| F2 Idea Studio | 0 | 0 | 7 | 0 |
| F3 Storyboard | 0 | 0 | 7 | 0 |
| F4–F6 Video engine (from M0) | 0 | 9 | 5 | 1 |
| F7 Revisions | 0 | 0 | 5 | 0 |
| F8 Build, preview & export | 0 | 0 | 8 | 0 |
| F9 Instagram | 0 | 0 | 8 | 1 |
| F10 Reliability & ops | 0 | 1 | 6 | 0 |

---

## 1. Planning & design (done)

| ID | Item | Status | Where |
|---|---|---|---|
| D1 | Product Requirements Document (v1.3) | ✅ | [PRD.md](PRD.md) |
| D2 | M0 technical proof: Gemini → ElevenLabs → synced motion graphics → MP4 (English + Hindi) | ✅ | [m0/](../m0/README.md) |
| D3 | Dark "midnight" video style based on the reference reel | ✅ | `m0/src/video/tech/` |
| D4 | System design (approved) | ✅ | [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) |
| D5 | Database design (approved) | ✅ | [DB_DESIGN.md](DB_DESIGN.md) |
| D6 | API design (approved) | ✅ | [API_DESIGN.md](API_DESIGN.md) |
| D7 | UI design system + 18 screens in Google Stitch | ✅ | [ui/README.md](ui/README.md) |
| D8 | Stitch prompts for every screen | ✅ | [ui/STITCH_PROMPTS.md](ui/STITCH_PROMPTS.md) |

---

## 2. Features

### F0 — Foundation

| ID | Feature | Status | Notes |
|---|---|---|---|
| F0.1 | Monorepo restructure: npm workspaces; move M0 into `packages/schema`, `pipeline`, `ai`, `voice`, `video` (no behaviour change) | ✅ | Done 2026-10-16. Verified: all 7 workspaces type-check; rebuilt EN + HI timelines/storyboards byte-identical to before; rendered frames pixel-identical; web production build OK; one React/zod version repo-wide. Azure adapter removed (approved-voices rule). |
| F0.2 | Unit-test setup (Vitest) + tests for validator, cue sync, beats, duration fitting | ⬜ | System Design §19 |
| F0.3 | `packages/db`: MongoDB client, migration runner, validators + all indexes from DB Design §8 | ⬜ | Replaces start-up index creation in the M1 draft |
| F0.4 | API foundation: `/api/v1` route helpers, error format, request id, Zod validation, Origin check, cursor pagination | ⬜ | API Design §2–§7 |
| F0.5 | Commit history + CI (typecheck, lint, tests on every push) | 🔵 | Repo on GitHub with full history (2026-10-16); CI still to add |

### F1 — Accounts & project library

The M1 draft in `apps/web` covers most of this and was tested by hand in the browser. It was written **before** the DB and API designs, so each 🟡 item still needs aligning (gaps listed in Notes).

| ID | Feature | Status | Notes |
|---|---|---|---|
| F1.1 | Sign up with email + password, verification email | 🔵 | Checked in the browser: sign up → link → verified → Library. Real email reaches only the Resend owner address (testing sender); in dev, rejected emails print in the terminal — see [setup guide](setup/AUTH_EMAIL_SETUP.md). Test: `npm run email:test` |
| F1.2 | Sign in / sign out, session cookie, route protection | 🟡 | Works; uses `proxy.ts` + data access layer |
| F1.3 | Forgot / reset password | 🔵 | Test with real email after Resend setup |
| F1.4 | Google sign-in + account linking | 🔵 | Waiting for your Google OAuth client ([guide §C](setup/AUTH_EMAIL_SETUP.md)) |
| F1.5 | Profile created automatically with India-first defaults | 🟡 | Missing `defaultAudience`, `role` (DB Design §4.2) |
| F1.6 | Library list: filters, search, pagination, needs-attention section | 🟡 | Uses server actions; must move to `GET /api/v1/projects` with cursor `{u, i}` (API §13.2) |
| F1.7 | Create video (new draft project) | 🟡 | Must also create the idea session in one transaction (DB §6.1) |
| F1.8 | Rename / duplicate / delete with 10-second undo / restore | 🟡 | Works; needs `rev` / If-Match and the delete cascade (DB §6.6) |
| F1.9 | Project page shell with Idea → Storyboard → Video stepper | 🟡 | Placeholder content until F2 |
| F1.10 | Settings: defaults (language, length, voice, time zone, notifications) | 🟡 | Works; move to `PATCH /api/v1/me/profile` |
| F1.11 | Delete account (full data deletion job) | ⬜ | Draft deletes projects/profile only; needs the job in DB §6.12 |
| F1.12 | Onboarding "Welcome" screen | ⬜ | Stitch screen 16 |
| F1.13 | Usage limits per day (`usage_counters`) | ⬜ | PRD §20.6, DB §7.5 |
| F1.14 | Cross-user security tests for every route | ⬜ | System Design §13.2 |

### F2 — Idea Studio

| ID | Feature | Status | Notes |
|---|---|---|---|
| F2.1 | Idea session autosave (`PUT /projects/{id}/idea`) | ⬜ | |
| F2.2 | "Find a topic" → 5 AI idea suggestions | ⬜ | Gemini fast model |
| F2.3 | "I have an idea" → brief + 2 alternative angles | ⬜ | |
| F2.4 | "Use my notes" (≤ 20,000 chars) → focused brief | ⬜ | Prompt-injection hygiene |
| F2.5 | Idea chat to refine the brief | ⬜ | |
| F2.6 | Video settings panel (language, length, audience, board/exam, voice, style) | ⬜ | Only the two approved voices |
| F2.7 | Idea Studio screen (Stitch screen 09) | ⬜ | |

### F3 — Storyboard

| ID | Feature | Status | Notes |
|---|---|---|---|
| F3.1 | `storyboard.generate` job (Gemini + validation + length check) | ⬜ | Logic proven in M0 |
| F3.2 | Storyboard versions saved in a transaction | ⬜ | DB §6.3 |
| F3.3 | Storyboard Review screen: scene cards with animated thumbnails | ⬜ | Stitch screen 10 |
| F3.4 | Instagram caption + hashtags panel | ⬜ | |
| F3.5 | Version history + restore | ⬜ | |
| F3.6 | Manual scene edits (text, delete, reorder) | ⬜ | P1 |
| F3.7 | Accuracy check flags | ⬜ | P1 |

### F4–F6 — Video engine (motion graphics, voice, sync)

Proven in M0; code now lives in `packages/*` (F0.1). Each becomes ✅ once covered by tests (F0.2).

| ID | Feature | Status | Notes |
|---|---|---|---|
| F4.1 | Midnight style: dark world, typing `//` eyebrow, headline beats | 🟡 | M0 |
| F4.2 | 9 scene types (TitleHook, KeywordReveal, BulletSteps, Flowchart, Comparison, StatCounter, RecapOutro, Illustration, UnitGrid) | 🟡 | M0 |
| F4.3 | Illustration library: 23 animated glowing objects + flows | 🟡 | M0 |
| F4.4 | Remaining 7 scene types (Cycle, Timeline, SimpleChart, Definition, Equation, IconGrid, Analogy) | ⬜ | PRD §14.2 |
| F4.5 | Render performance: glow/blur ≤ 2× real time | ⬜ | Currently ~2.1–2.9× |
| F5.1 | ElevenLabs voice with timings, approved voices only, no fallback | 🟡 | M0 |
| F5.2 | Forced-alignment fallback | 🟡 | M0 |
| F5.3 | **Your own two voices working through the API** | ⛔ | Needs a paid ElevenLabs plan (Creator or $5 of credits) |
| F5.4 | Text normalisation + pronunciation dictionary | ⬜ | PRD §15.1 |
| F6.1 | Cue sync to spoken words (exact / fuzzy / fallback) | 🟡 | M0, 95–100% exact |
| F6.2 | Duration fitting (learned speed per voice + one re-record) | 🟡 | M0 |
| F6.3 | Gemini length correction | 🟡 | M0 |
| F6.4 | Optional captions toggle (off by default) | ⬜ | DB assumption A3 |
| F6.5 | Video safe-zone check on Instagram overlay | ⬜ | |

### F7 — Conversational revisions

| ID | Feature | Status | Notes |
|---|---|---|---|
| F7.1 | Revision plan from Gemini (operations, not a rewrite) | ⬜ | System Design §8.5 |
| F7.2 | Apply operations → new version; only changed scenes rebuilt | ⬜ | |
| F7.3 | Revision chat panel with scene scope + quick replies | ⬜ | Stitch screen 10 |
| F7.4 | Undo last revision | ⬜ | DB §6.4 |
| F7.5 | Clarifying questions / unsupported requests | ⬜ | |

### F8 — Build, preview & export

| ID | Feature | Status | Notes |
|---|---|---|---|
| F8.1 | `build.run` job (voice per scene, cache, timeline) | ⬜ | |
| F8.2 | Progress polling endpoint + Building screen | ⬜ | Stitch screen 11 |
| F8.3 | Live preview in the browser (Remotion Player) | ⬜ | Stitch screen 12 |
| F8.4 | Render agent on your PC (queue, leases, heartbeat, R2 upload) | ⬜ | System Design §10.3 |
| F8.5 | `render.run` job + export button | ⬜ | |
| F8.6 | Download MP4 + cover | ⬜ | |
| F8.7 | Cancel / retry from the failed step | ⬜ | |
| F8.8 | Notifications (in-app + email) | ⬜ | Stitch screen 17 |

### F9 — Instagram publishing

| ID | Feature | Status | Notes |
|---|---|---|---|
| F9.1 | Meta developer app setup | ⬜ | Needs your business details |
| F9.2 | Connect Instagram (eligibility modal + OAuth) | ⬜ | Stitch screen 15 |
| F9.3 | Post now | ⬜ | Stitch screen 13 |
| F9.4 | Schedule / edit / cancel | ⬜ | |
| F9.5 | Posted + failed states, retry | ⬜ | Stitch screen 14 |
| F9.6 | Token refresh + reconnect flow | ⬜ | |
| F9.7 | Meta webhooks (deauthorize, data deletion) | ⬜ | |
| F9.8 | Meta App Review approval | ⛔ | External; needed before public launch |

### F10 — Reliability, ops & launch

| ID | Feature | Status | Notes |
|---|---|---|---|
| F10.1 | Background jobs set up (Inngest) + daily purge of deleted projects | 🟡 | Draft endpoint works locally |
| F10.2 | Watchdog for stuck jobs + render agent alerts | ⬜ | |
| F10.3 | Error tracking (Sentry) + structured logs | ⬜ | |
| F10.4 | Staging environment (Vercel + Atlas + R2 + Inngest) | ⬜ | Needs your accounts |
| F10.5 | Admin view (metadata only) | ⬜ | M7 |
| F10.6 | End-to-end tests (Playwright) | ⬜ | |
| F10.7 | Private beta launch | ⬜ | |

---

## 3. Open items needing you

| # | Item | Needed for |
|---|---|---|
| 1 | Upgrade ElevenLabs (Creator plan or $5 of credits) | F5.3 and every real video |
| 2 | Google OAuth client ID/secret | F1.4 |
| 3 | Domain + trademark check for "Videozilla" | Email sending, OAuth, Meta review |
| 4 | Accounts: MongoDB Atlas, Cloudflare R2, Inngest, Vercel, Resend, Sentry | F10.4 staging |
| 5 | Meta developer app + business verification | F9 |

---

## Change log

| Date | Change |
|---|---|
| 2026-10-16 | PRD v1.0–v1.3 written and approved (name Videozilla, India-first, MongoDB stack, local render PC, ElevenLabs voices). |
| 2026-10-16 | M0 proof built: real English + Hindi videos with Gemini + ElevenLabs; midnight dark style, illustrations, unit grid; duration fitting; approved-voices-only rule. |
| 2026-10-16 | M1 web app drafted (auth, library, project page, settings) and tested by hand — **before** the design docs, so marked 🟡. |
| 2026-10-16 | System, database and API design documents approved. |
| 2026-10-16 | Videozilla UI recreated in Google Stitch + 10 new screens designed (18 total, all confirmed on the canvas). |
| 2026-10-16 | Project status document created; from now on the app is built one feature at a time. |
| 2026-10-16 | F1.1–F1.4 started: found emails only print to the terminal (no RESEND_API_KEY); wrote [setup guide](setup/AUTH_EMAIL_SETUP.md) and added `npm run email:test`. Waiting for Resend + Google keys. |
| 2026-10-16 | Resend verified: test email delivered (key is on the jaicte37@gmail.com Resend account; test sender only emails that address). Google keys not loaded yet. |
| 2026-10-16 | Code pushed to GitHub (ETHANHUNT53/videozilla): docs, m0 engine, apps/web draft. Rule: commit + push after every feature/step. Local test password moved out of .env.example. |
| 2026-10-16 | Created `dev` branch for ongoing work; `main` is updated only on approved merges. |
| 2026-10-16 | **F0.1 done** — monorepo with npm workspaces: `packages/schema`, `pipeline`, `ai`, `voice`, `video` + `apps/web` + `m0`. Outputs verified identical to before. Root README added. |
| 2026-10-16 | Fixed sign-up 500 ("Couldn't create your account"). Causes: the database wasn't running and the dev server kept a dead connection; Resend's testing sender also rejected non-owner addresses, so Better Auth rolled the sign-up back. In dev, rejected emails now print in the terminal, and server errors show a clearer message. Sign-up → verify → Library checked in the browser. |
