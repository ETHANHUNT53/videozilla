# Videozilla — Project Status

> **Repository:** https://github.com/ETHANHUNT53/videozilla
> - **`dev`** — all ongoing work; every finished feature or step is committed **and pushed** here together with an update to this document.
> - **`main`** — stable; `dev` is merged into `main` only when you approve a finished milestone.
>
> **How this document works.** The app is built **one small feature at a time**. Every feature has an ID below. When a feature is started, finished, blocked or changed, its row is updated **and** a line is added to the [Change log](#change-log). This document is the single place to see where the project stands.

| | |
|---|---|
| **Last updated** | 2026-10-17 |
| **Current phase** | Feature build — F1 accounts & library: moving the M1 draft onto the API and DB designs (F1.4 Google sign-in waits for your Google keys) |
| **Next feature** | **F1.8 — Rename / duplicate / delete / restore on the API**: `PATCH`, `DELETE`, `/restore`, `/duplicate` with `rev` / `If-Match` and the delete cascade (API §13.2, DB §6.6–6.7) |
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
| F0.2 | Unit-test setup (Vitest) + tests for validator, cue sync, beats, duration fitting | ✅ | Done 2026-10-16. `npm test`: 97 tests over schema, pipeline (text, validator, cue sync, beats, captions, duration fitting), voice (approved voices only, no fallback, timings, mock) and ai (busy retry, fallback model, JSON/shape/length fixes). Checked that breaking a rule makes tests fail. Video rendering is covered later by visual-regression tests |
| F0.3 | `packages/db`: MongoDB client, migration runner, validators + all indexes from DB Design §8 | ✅ | Done 2026-10-17. Migrations `001_initial_schema` (19 collections, 12 validators, 36 indexes) and `002_profile_defaults`; `npm run db:migrate` (`-- --status` to list); `npm run db` applies them on start. Web app uses the shared client; start-up index creation removed. 40 integration tests on a throwaway MongoDB |
| F0.4 | API foundation: `/api/v1` route helpers, error format, request id, Zod validation, Origin check, cursor pagination | ✅ | Done 2026-10-17. `apiRoute()` wrapper in `apps/web/src/server/api/`; first endpoint `GET /api/v1/me`; unknown `/api/v1` paths return JSON 404. 35 tests; checked against the running app. Rate limits stay at the edge (F10) |
| F0.5 | Commit history + CI (typecheck, lint, tests on every push) | ✅ | Done 2026-10-17. GitHub Actions `CI` workflow on every push and pull request (Ubuntu 24.04, Node 22): install, typecheck, lint, unit tests; test counts shown on the run page. First green runs: [#1](https://github.com/ETHANHUNT53/videozilla/actions/runs/39007909555), [#2](https://github.com/ETHANHUNT53/videozilla/actions/runs/39008053595) (188 tests) |

### F1 — Accounts & project library

The M1 draft in `apps/web` covers most of this and was tested by hand in the browser. It was written **before** the DB and API designs, so each 🟡 item still needs aligning (gaps listed in Notes).

| ID | Feature | Status | Notes |
|---|---|---|---|
| F1.1 | Sign up with email + password, verification email | ✅ | Checked in the browser: sign up → link → verified → Library. Real email reaches only the Resend owner address until a domain is verified; in dev, rejected emails print in the terminal — see [setup guide](setup/AUTH_EMAIL_SETUP.md) |
| F1.2 | Sign in / sign out, session cookie, route protection | ✅ | Checked: sign out/in, wrong password, Library protected. Sessions are checked against the database on every page (revoked sessions stop at once); proxy only sends signed-out visitors to sign-in |
| F1.3 | Forgot / reset password | ✅ | Checked: reset link → new password works, old password fails, other sessions revoked |
| F1.4 | Google sign-in + account linking | 🔵 | Waiting for your Google OAuth client ([guide §C](setup/AUTH_EMAIL_SETUP.md)) |
| F1.5 | Profile created automatically with India-first defaults | ✅ | Now writes `defaultAudience` and `role` (DB Design §4.2), enforced by the database validator; existing profiles backfilled by migration 002 (F0.3) |
| F1.6 | Library list: filters, search, pagination, needs-attention section | ✅ | Done 2026-10-17. `GET /api/v1/projects` (filter, q, limit, cursor) and the Library page share one list service; cursor pages sorted by last change then id (no gaps or repeats); "Load older videos" loads from the API. 14 integration tests on a throwaway MongoDB; checked in the browser with 28 videos |
| F1.7 | Create video (new draft project) | ✅ | Done 2026-10-17. `POST /api/v1/projects` (optional title, language, length, voice; rest from the profile) creates the project with every DB §4.3 field and its idea session in one transaction; returns `201 Project` with `allowedActions` (DB §5.2). "+ Create video" calls it. Migration 003 gave the 7 existing projects their idea sessions |
| F1.8 | Rename / duplicate / delete with 10-second undo / restore | 🟡 | Works. Duplicate now copies the idea session in one transaction (DB §6.13, done in F1.7); still to do: move to the API, `rev` / If-Match, delete cascade (DB §6.6) |
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
| F5.1 | ElevenLabs voice with timings, approved voices only, no fallback | 🟡 | Unit-tested with a mocked API (F0.2); ✅ once a real call with your voices works (F5.3) |
| F5.2 | Forced-alignment fallback | ✅ | Unit-tested (F0.2) |
| F5.3 | **Your own two voices working through the API** | ⛔ | Needs a paid ElevenLabs plan (Creator or $5 of credits) |
| F5.4 | Text normalisation + pronunciation dictionary | ⬜ | PRD §15.1 |
| F6.1 | Cue sync to spoken words (exact / fuzzy / fallback) | ✅ | M0, 95–100% exact; unit-tested (F0.2) |
| F6.2 | Duration fitting (learned speed per voice + one re-record) | ✅ | Unit-tested (F0.2) |
| F6.3 | Gemini length correction | ✅ | Unit-tested (F0.2) |
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
| F10.4 | Staging environment (Vercel + Atlas + R2 + Inngest) | ⬜ | Needs your accounts. **Includes the migrate-on-deploy step:** each deploy must run `npm run db:migrate` against that database before the new code serves traffic (the app refuses to run on an unmigrated database). CI (F0.5) only checks code and does not deploy |
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
| 2026-10-16 | **F1.1–F1.3 done** (checked in the browser). Fixed: revoked sessions stayed valid for up to 5 min (cookie cache) — the data access layer now checks the database; the proxy no longer redirects auth pages on a cookie alone, which could loop after a revoked session. F1.4 waits for Google keys. |
| 2026-10-16 | Code-review fixes (auth/email): in dev, an email that fails to send because of a network error now prints in the terminal too (it used to fail sign-up); in production a missing `RESEND_API_KEY` is an error instead of printing links to the logs; the session cookie cache is now off in the auth config itself, so revoked sessions stop at once everywhere, not just in the data access layer. |
| 2026-10-16 | **F0.2 done** — Vitest 4.1.11 at the root (`npm test`), 97 unit tests for the shared packages; F5.1, F5.2, F6.1–F6.3 now ✅. Vitest 5 / vite 8 hit an npm 10 install bug ("edgesOut"), so Vitest 4.1 was installed with npm 11 via npx; plain `npm install` still works with npm 10. |
| 2026-10-17 | F0.2 review fixes: voice tests no longer pick up `ELEVENLABS_MODEL` / `MOCK_WPM` from your shell; storyboard fixtures moved from `m0/fixtures` to `packages/schema/fixtures` (m0 commands updated) and must be named `<topic>.<en\|hi>[.90].json`; F5.1 back to 🟡 until a real ElevenLabs call with your voices works (F5.3). |
| 2026-10-17 | **F0.3 done** — new `packages/db`: shared MongoDB client, collection names, stored enums, migration runner (checksums, lock, `npm run db:migrate`), migration 001 (all collections, database validators, full index catalogue) and 002 (profile backfill). Local database migrated with all data kept (5 projects, 4 profiles). Web app: start-up index creation removed; new profiles get `defaultAudience` + `role` (F1.5 ✅). Checked in the browser: sign-up, verify, create project, settings save, delete + undo. |
| 2026-10-17 | Fixed a hydration error on the Library page: the cards' "just now" / "1 min ago" label was worked out separately on the server and in the browser and could differ. The server now passes its request time, both sides render from it, and the label switches to the browser clock (and keeps ticking) right after load. Looks the same. |
| 2026-10-17 | F0.3 review fixes: the migration lock is renewed before each migration and a run only releases its own lock (a run that lost it stops); `--status` also lists applied migrations whose file is gone; the web app checks once per process that the latest migration ran and fails with a clear error otherwise (production needs `npm run db:migrate` on deploy); `npm run db` stops if migrations fail; scripts use their own short-lived Mongo client; titles and names are cut by characters, never mid-emoji. |
| 2026-10-17 | **F0.4 done** — `/api/v1` foundation: one `apiRoute()` wrapper gives every endpoint a request id, the Origin (CSRF) check, session + verified-email checks, JSON/size/Zod input validation with trimming and NFC, the standard error body (full §7.2 catalogue) and `private, no-store` caching; cursor pagination helpers (filter-bound cursors). First endpoint `GET /api/v1/me`. Web server code is now covered by `npm test`. Decided: connect MongoDB Atlas at F10.4 (staging), not before — local dev already runs the same replica set + migrations. |
| 2026-10-17 | F0.4 + time-ago review fixes: `/api/v1` bodies are read as a stream and cut off at the size limit (no Content-Length needed); a handler that returns nothing answers `204`; returned Responses are copied so the wrapper can always add its headers; the Origin check also accepts the origin the request was sent to (127.0.0.1, preview deploys); a failing session lookup is a 500 even on public routes; cursor filters hash the same in any key order; unsupported methods get the JSON `405` (`methodNotAllowed`); pages and the API share one session lookup (`readSession`). Library cards older than 30 days are dated in the profile time zone, so server and browser match. |
| 2026-10-17 | **F0.5 done — F0 foundation complete.** GitHub Actions CI runs typecheck, lint and all unit tests (188, incl. MongoDB tests on Linux) on every push and pull request, no secrets needed. Pinned Ubuntu 24.04 (`ubuntu-latest` moves to Ubuntu 26 on 2026-10-19) and current action versions (v4 used the deprecated Node 20). Web typecheck now runs `next typegen` first; new root `npm run lint`. |
| 2026-10-17 | **F1.6 done** — Library on the API: new `GET /api/v1/projects` (filters all / drafts / ready / scheduled / posted / attention, title search incl. Hindi, cursor pages of 1–100, default 24) returning the API `ProjectSummary` shape; the Library page's first render uses the same service, and "Load older videos" fetches further pages from the endpoint (replaces the old `?before=` links). Paging is stable when many videos change at the same moment. |
| 2026-10-17 | F0.5 review fixes: CI also builds the web app (`next build`); `npm run lint` now lints `packages/*` too (root `eslint.config.mjs`; three M0 files keep `any` for now, marked in the file); CI runs on pushes to `dev` / `main` and on pull requests, so a PR commit runs once; the MongoDB binary cache is keyed on the mongodb-memory-server version; Node 22 pinned in `.nvmrc` + `engines`; actions pinned to commit SHAs. Migrate-on-deploy noted under F10.4. |
| 2026-10-17 | **F1.7 done** — Create video on the API: `POST /api/v1/projects` creates the project (all DB §4.3 fields, profile defaults) and its idea session in one MongoDB transaction and returns the `Project` resource with `allowedActions` from the DB §5.2 table; the Library button calls it (the old server action is gone). Duplicate also copies the idea session in a transaction. Migration `003_idea_sessions_backfill` gave existing projects an idea session. Web tests now use a one-node replica set for transactions. |
| 2026-10-17 | F1.6 review fixes: one `normalizeSearch` (no control characters, NFC, trimmed, 80 characters) cleans the search for both the Library page and `GET /api/v1/projects`, so "Load older videos" never gets "page link expired"; the API counts the 80 in characters (emoji ok); the main list leaves out needs-attention projects in the query (`exclude=attention`), so they never show twice and pages stay full; the list always shows the latest server render after an action (older pages kept below); no double loads on fast clicks; a signed-out "Load more" goes to sign-in. CI build placeholder fails fast if a build ever queries the database. Title search stays an unanchored regex (scans the user's projects; fine at library sizes, the toolbar waits 300 ms). |
