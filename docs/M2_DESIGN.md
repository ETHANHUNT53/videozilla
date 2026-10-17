# M2 — Idea Studio + Storyboard: design

| | |
|---|---|
| **Status** | **Approved 2026-10-17** (answers in §7). F2.1 built |
| **Date** | 2026-10-17 |
| **Sources** | PRD F2 / F3 / F10-FR1 / §20.6, System Design §8 / §11, DB Design §4.4–4.6 / §6.3 / §7, API Design §8 / §13.3 / §13.4 / §13.7 |
| **Milestone goal (PRD §22)** | End to end: idea → validated storyboard, in the web app |

This document doesn't change the approved System, DB or API designs. It says in what order M2 gets built, how each piece uses those designs, and what still needs your decision.

---

## 1. What you'll be able to do at the end of M2

1. Open a video and plan it in the **Idea Studio** (Stitch screen 09), in one of three ways:
   - **Find a topic:** type a subject, get 5 idea cards, "Use this" or "Suggest 5 more";
   - **I have an idea:** type up to 500 characters, get a sharpened brief plus 2 other angles;
   - **Use my notes:** paste up to 20,000 characters of notes in any language, get a focused 60–90 s brief that says what's in and what's left out.
2. Refine the brief by chatting ("make it for Class 8", "focus on the second point"), or edit its title and key points directly.
3. Everything you type saves by itself ("Saving…" / "Saved" / "Offline — will save when reconnected").
4. Press **Generate storyboard**: a background job writes the script and scenes with Gemini, checks and repairs them, fixes the length, and shows progress while it runs.
5. Review the storyboard (Stitch screen 10): scene cards with animated thumbnails, plus the Instagram caption and hashtags.
6. P1 items if time allows: version history and restore, small manual scene edits, accuracy flags.

Voice and the final video come in M3–M4, so M2 ends at an approved-looking storyboard, not a video.

---

## 2. Build order (one feature at a time, as before)

| # | Feature | What gets built | Depends on |
|---|---|---|---|
| 1 | **F2.1** Idea autosave | `GET` / `PUT /projects/{id}/idea`, the shared autosave hook, a first working Idea step (3 mode tabs and their inputs) | — |
| 2 | **F2.2** Find a topic | `POST …/idea/suggestions` → 5 cards; "Use this", "More like this", "Suggest 5 more" | Gemini key in the web app (Q1) |
| 3 | **F2.3** I have an idea | `POST …/idea/brief` `{ from: "idea" }` → brief + 2 alternatives; brief card | F2.2's AI wrapper |
| 4 | **F2.4** Use my notes | same endpoint `{ from: "notes" }`; notes passed as delimited data, never as instructions | F2.3 |
| 5 | **F2.5** Idea chat | `GET` / `POST …/idea/chat`; each reply updates the brief, changed fields highlighted | F2.3 |
| 6 | **F2.8** Brief edits + title | `PATCH …/idea/brief` (PRD F2-FR7); the video title follows the brief title until you rename it (F2-FR11) | F2.3 |
| 7 | **F2.7** Idea Studio screen | the full Stitch 09 layout and polish around the pieces above | 1–6 |
| 8 | **F3.1 + F3.2** Generate storyboard | `POST …/storyboard/generate` (`202`), the `storyboard.generate` job, versions saved in a transaction, usage counted, progress via `GET …/status` | F2.3 |
| 9 | **F3.3** Storyboard screen | scene cards with animated thumbnails (the M0 scene components, in the browser) | 8 |
| 10 | **F3.4** Caption + hashtags | panel on the storyboard screen | 8 |
| 11 | P1: **F3.5** versions, **F3.6** manual edits, **F3.7** accuracy flags | as listed in PROJECT_STATUS | 8–9 |

F2.6 (the settings panel) was already built with F1.9. "F2.8" is a new row for PRD F2-FR7 / FR11, which had no row yet.

---

## 3. F2.1 in detail (the first feature)

### 3.1 API (API Design §13.3, §8)

- **`GET /api/v1/projects/{id}/idea`** → `200 IdeaSession` with `ETag: "<rev>"`.
- **`PUT /api/v1/projects/{id}/idea`**:
  - **Body:** `{ mode, topicInput?, ideaInput?, notesText? }`. It's strict, so unknown fields such as `userId`, `brief` or `rev` give `400`.
  - **Missing fields** stay as they are. The three inputs are kept separately, so switching tabs never loses text.
  - **Limits:** topic ≤ 200, idea ≤ 500 and notes ≤ 20,000 characters, counted like the database counts them (code points, after trimming and NFC normalisation). The body limit for this route is 128 KB.
  - **`If-Match: "<rev>"`:**
    - matches: the save applies and `rev` goes up by 1;
    - doesn't match: `412 PRECONDITION_FAILED` with the current idea in `details.current`;
    - missing: last write wins.
  - **Allowed** only while the project allows `edit_idea` (`idea_draft`, `storyboard_ready`); otherwise `409 INVALID_STATE`. In `storyboard_ready` the change applies to the next generation; the current storyboard isn't touched.
  - **No-op save:** if nothing actually changed, `200` with the same `rev`, so an echo from the autosave doesn't bump versions.
  - **Someone else's or an unknown project:** `404`, the same as everywhere. The F1.14 coverage check forces new cross-user cases for both methods.
- **Saving the idea also updates the project's "last changed" time** (not its `rev`), in the same transaction, so a video you're working on moves to the top of the Library.

### 3.2 Autosave in the browser (PRD F10-FR1)

- **One shared hook** (`useAutosave`), reused later by brief edits and storyboard edits:
  - debounced 800 ms, one save in flight at a time; newer text waits and is sent next;
  - sends `If-Match` with the last `rev` it saw;
  - shows "Saving…", "Saved", or "Offline — will save when reconnected" (it retries when the browser comes back online).
- **Leaving the page with unsaved text** shows the browser's "Leave site?" warning.
- **Another tab changed the idea (412):** autosave pauses and a bar says "This idea was changed in another tab" with two buttons:
  - **Load latest** — show the other tab's text;
  - **Keep mine** — save yours over it.
- **The project page's idea step** replaces today's "Arriving in M2" card with:
  - the three tabs (Find a topic / I have an idea / Use my notes);
  - their inputs with character counters;
  - the save status.

  The AI buttons appear disabled with "coming next" until F2.2–F2.4. F2.7 later restyles the whole step to match Stitch screen 09.

### 3.3 Also fixed in F2.1 (QA leftover on the same page)

**Real 404 for the project page.** `/projects/{unknown or someone else's id}` answers `200` with not-found content today, because the lookup runs inside the streamed part of the page. The lookup and `notFound()` move before the Suspense boundary, so the page returns a real `404`. F2.1 reworks this page anyway.

### 3.4 Tests

- **Repository and route tests:** create/read, partial saves, limits (including Hindi text and emoji counted correctly), `If-Match` match / mismatch / missing, the no-op save, status rules, `128 KB` vs `413`.
- **Cross-user cases** for `GET` / `PUT …/idea`.
- **Hook tests** with fake timers: debounce, one in flight, offline then online, `412`.
- **A browser check:** type, reload, the text is still there; two tabs → the conflict bar.

---

## 4. The AI features (F2.2–F2.5) — how they'll work

- **Model:** `llm.fast` (`gemini-3.8-flash`) through the existing `packages/ai` wrapper: structured JSON validated with Zod, busy retries then `gemini-3.5-flash-lite`, up to 2 repair rounds, 15 s budget. Every call is logged to `ai_calls` (model, tokens, latency, outcome).
- **Inputs to the prompt:** the project's language, audience and board/exam, plus your profile's "what I teach or create about" (F1.12), so suggestions fit you.
- **Pasted notes and your own text are data, never instructions.** They're wrapped in clear delimiters, and the prompt says to ignore instructions inside them (System Design §8.3).
- **Safety:** prohibited topics (PRD §21.1) get `422 UNSAFE_CONTENT` with a plain message.
- **Errors:** after retries, `503 AI_BUSY` with `Retry-After`; the UI shows "Gemini is busy, try again in a few seconds" and keeps your text.
- **Responses** are plain JSON in V1. The typing effect (streaming) is P1, as agreed in API Design P2.
- **Idempotent chat:** each chat message carries a `clientMessageId`, so a double send or a retry doesn't create two replies.

---

## 5. Generate storyboard (F3.1–F3.2) — how it'll work

1. **`POST /projects/{id}/storyboard/generate`** (allowed in `idea_draft` with a brief, or `storyboard_ready` with `{ regenerate: true }`). In **one transaction**:
   - count today's `storyboards` usage (`consumeUsage(..., { session })`; `429 LIMIT_REACHED` at 20/day);
   - move the project to `storyboard_generating` (compare-and-set on the status);
   - create the pipeline run (one active run per project: the unique index answers a second click with the same run).

   The response is `202 { run, project }`, and then the job event is sent.
2. **The `storyboard.generate` job** (Inngest; it runs inline when the job server isn't running, like account deletion does):
   - load the brief and settings;
   - Gemini `llm.heavy` storyboard (the M0 prompt and validator from `packages/ai` / `packages/pipeline`);
   - validate and repair;
   - one length correction;
   - save version N in a transaction (DB §6.3): `storyboard_versions` insert, project `currentVersion`, status `storyboard_ready`.

   **On failure:** back to the previous status with `needs_attention` and a plain-language reason; the storyboard counter isn't refunded (it was a real Gemini call).
3. **Progress:** the page polls `GET /projects/{id}/status` every 2 s while the run is active and stops when it's done or the tab is hidden. The steps show as pending / running / done / failed.

---

## 6. Things I'm deciding unless you object

| # | Decision | Why |
|---|---|---|
| D1 | Idea inputs save to the server only (not also to the browser's storage); unsaved text triggers a "Leave site?" warning | Simpler and safe enough; chat drafts (F2.5) do use local storage, as the PRD asks |
| D2 | Two-tab conflict: "Load latest" / "Keep mine" bar | Never silently loses someone's typing |
| D3 | Editing the idea moves the video to the top of the Library | It's the video you're working on |
| D4 | No streaming (typing effect) in V1 | Already agreed (API P2) |
| D5 | The real-404 fix goes into F2.1; the other QA cosmetics (onboarded user opening `/welcome` sees a spinner before going to the Library; an unverified user briefly sees "Loading your videos…" before `/verify-email`) are listed in PROJECT_STATUS and fixed when those pages are next touched | Small, cosmetic, no data risk |

---

## 7. Questions for you

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| **Q1** | **Gemini key for the web app.** Your key is in `m0/.env`, but the web app (`apps/web/.env.local`) has none. Do you want to add `GEMINI_API_KEY` there yourself, or let me copy it from `m0/.env` with a local script that never prints it? | Needed from F2.2 (the first AI feature). F2.1 doesn't need it. | Either works. Copying it locally is quickest; it stays in the git-ignored file. You stay on the free tier for now (System Design Q9: switch to paid before the beta). |
| **Q2** | **A daily cap for idea AI calls?** PRD §20.6 caps storyboards (20), revisions, builds, renders and illustrations, but not idea suggestions, briefs or chat. | Each is a cheap `flash` call, but there's no ceiling against runaway use. | Add one shared counter, **`ideas`: 150 per day** (suggestions + briefs + chat messages), with the same `429` message and IST reset as the others. |

**Answers (2026-10-17):** approved as written. **Q1:** the engineer copies `GEMINI_API_KEY` from `m0/.env` into the git-ignored `apps/web/.env.local` with a local script that never prints it — done at the start of F2.2, the first feature that needs it. **Q2:** one shared `ideas` counter, **150 per day** (suggestions + briefs + chat messages), same `429 LIMIT_REACHED` message and IST reset as the other limits — added with F2.2.
