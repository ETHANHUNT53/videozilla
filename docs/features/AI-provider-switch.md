# AI provider switch — Gemini → Groq → OpenRouter chain

> **Update 2026-10-19:** the default is now a three-tier chain (`AI_PROVIDER=chain`): Gemini first, Groq if Gemini isn't available, OpenRouter if Groq isn't either. See [Three-tier chain](#three-tier-chain-added-2026-10-19). The sections before it describe the Groq + OpenRouter switch of 2026-10-18, which is still available as `AI_PROVIDER=groq`.

**Status:** approved 2026-10-18 (main `openai/gpt-oss-120b`, backup `google/gemma-4-31b-it:free`; OpenRouter's 50 free requests a day is fine) and built. The live check waits for the keys.

**Sources:** System Design §8.1 (models) and §8.2 (call wrapper), [F2.2](F2.2-topic-suggestions.md), [F2.3](F2.3-idea-brief.md). Model lists and limits were checked on 2026-10-18 on console.groq.com/docs and openrouter.ai/api/v1/models.

## Why

The Gemini key is out of free quota and out of prepaid credits, so "Find a topic" and briefs answer `503 AI_BUSY` every time. For development we switch to free providers:
- **Groq** is the main provider.
- An **OpenRouter `:free` model** is the backup.

Gemini stays fully supported. Before launch we buy a paid Gemini plan and set `AI_PROVIDER=gemini` in the environment. No code change is needed for that.

## What changes for you

Nothing on screen. "Find a topic" and "Sharpen my idea" work again, and so do the errors you already know (`422 UNSAFE_CONTENT`, `503 AI_BUSY`, `429 LIMIT_REACHED`). Only the model that writes the text is different.

## Models

### Main: Groq — `openai/gpt-oss-120b`

Groq's free plan now covers only three general chat models: `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`. The Llama models now need an Enterprise plan.

| Model | Type | Free limits (per minute / per day) | Notes |
|---|---|---|---|
| **`openai/gpt-oss-120b`** ← proposed | production | 30 requests, 8K tokens / 1K requests, 200K tokens | Largest free model; strong multilingual; very fast on Groq; supports `json_object` and strict `json_schema` |
| `qwen/qwen3.8-27b` | **preview** ("may be discontinued at short notice") | same | Qwen is often stronger in Hindi. In the live check I run the same Hindi topic on both and report which reads better |
| `openai/gpt-oss-20b` | production | same | Smaller; not proposed |

**What the limits mean for us:** one "Find a topic" call is about 2–3K tokens with reasoning set to `low`. So the free plan allows about 3 calls a minute and 60–80 a day. That's enough for development, not for users.

### Backup: OpenRouter — `google/gemma-4-31b-it:free`

| Model | `response_format` | Why |
|---|---|---|
| **`google/gemma-4-31b-it:free`** ← proposed | JSON mode ✅ | Gemma is trained on 140+ languages and writes good Hindi; dense 31B model |
| `nvidia/nemotron-3-super-120b-a12b:free` | JSON mode + strict schema ✅ | Larger, but mostly English-tuned; second choice |

OpenRouter has no free gpt-oss, Llama or Qwen model today.

**Free limits:** 20 requests a minute, and **50 requests a day** while the account has never bought credits (1,000 a day after a one-time $10 purchase). The backup is only used when Groq is busy or out of quota, so 50 a day is fine for now.

### Gemini (later, paid)

Unchanged: `gemini-3.8-flash`, falling back to `gemini-3.5-flash-lite` (`GEMINI_FAST_MODEL`, `GEMINI_FALLBACK_MODEL`).

## Settings (`apps/web/.env.local`)

| Setting | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `groq` | `groq` = Groq main + OpenRouter backup. `gemini` = the Gemini path exactly as today. |
| `GROQ_API_KEY` | — | Needed when `AI_PROVIDER=groq` |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Main model |
| `OPENROUTER_API_KEY` | — | Optional: without it there's no backup, and Groq gets both tries |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it:free` | Backup model. Leave the setting empty to turn the backup off |
| `GEMINI_API_KEY`, `GEMINI_FAST_MODEL`, `GEMINI_FALLBACK_MODEL` | as today | Used only when `AI_PROVIDER=gemini` |

Model names have defaults in code but always come from settings first, so a model that Groq retires can be swapped with no code change. An unknown `AI_PROVIDER` value is a clear start-up error ("AI_PROVIDER must be groq or gemini"). It never silently falls back to another provider.

## Design

### One wrapper, two kinds of backend

`generateJson` keeps everything it does today. Only the "send one request" step moves behind a small interface:

```
generateJson (unchanged behaviour)
 ├─ plan: [main, main, backup]           ← from AI_PROVIDER
 ├─ deadline 15 s + fallback reserve
 ├─ quota / billing circuit breakers     ← keyed by provider + model
 ├─ JSON parse + Zod check + 1 repair round
 └─ onCall → ai_calls (now with `provider`)
        │
        ├─ geminiBackend          (today's code, moved as is: block reasons, RECITATION, thinkingConfig)
        └─ openAiCompatBackend    (new: one adapter for Groq and OpenRouter)
```

### The OpenAI-compatible adapter

- **Plain `fetch` to `POST {baseUrl}/chat/completions`.** No new dependency: the request is small, and fetch is easy to mock in tests. The official `openai` SDK adds retries of its own, which would fight our retry and deadline logic.
- **Base URLs:** `https://api.groq.com/openai/v1` and `https://openrouter.ai/api/v1`.
- **Request:**
  - `messages`: our system prompt plus the conversation (the repair round adds turns as it does today);
  - `response_format: { type: "json_object" }`;
  - `temperature`;
  - `max_completion_tokens: 4096`;
  - `AbortSignal` for the deadline.
- **Why `json_object` and not a strict `json_schema`:** Groq's strict mode needs every field marked required and `additionalProperties: false`. Our Zod schemas have optional fields and `.catch()` defaults that don't convert cleanly. Our prompts already list every field, and Zod plus the repair round already catch a wrong shape.
- **Per-model settings**, like today's `MODEL_CONFIG`:
  - `gpt-oss-*`: `reasoning_effort: "low"` and `include_reasoning: false` (quicker, fewer tokens; reasoning isn't needed for these short creative tasks);
  - `qwen/qwen3.8-*`: `reasoning_effort: "none"`.
- **Groq "the model wrote invalid JSON" errors:** Groq answers JSON mode with a 400 when the generated text isn't valid JSON, and puts the text it generated in the error. That goes into the repair round as "not valid JSON", the same as a Gemini reply that doesn't parse.
- **OpenRouter specifics:**
  - `provider: { require_parameters: true }`, so it only routes to hosts that honour JSON mode;
  - headers `HTTP-Referer: http://localhost:3000` and `X-OpenRouter-Title: Videozilla`;
  - a `200` whose body holds `error` and no `choices` is treated as that error (OpenRouter documents this case).

### Errors → existing behaviour

| What the provider says | Treated as | Result |
|---|---|---|
| 429 rate limit (per-minute) | busy + **quota cooldown** for the `retry-after` time (at least 10 s) | next try / backup |
| 429 daily cap (Groq "requests per day" / "tokens per day", OpenRouter free daily limit) | **quota cooldown** until the reset time the provider gives, else 30 min | backup; `503 AI_BUSY` with `Retry-After` when everything is cooling down |
| 402 (OpenRouter: no credits / negative balance) | **billing cooldown**, 30 min, plus a loud server-log line ("top up at openrouter.ai") | backup / `503` |
| 408, 5xx, 498, timeout, network error | busy | one retry, then the backup |
| 400 invalid-JSON | unusable reply | repair round |
| 401 / 403 (bad key) | a bug in setup: fails at once, logged | `500`, with "check GROQ_API_KEY" in the server log |
| OpenRouter 403 moderation (`content_policy_violation`) | **blocked**, like Gemini's safety filters | `422 UNSAFE_CONTENT` |

### Safety

Groq and OpenRouter don't give Gemini-style block reasons. Safety relies on the prompt's existing `{"refused":true,"category":…}` path (F2.2 and F2.3), which already maps to `422 UNSAFE_CONTENT` with our own sentence. OpenRouter's moderation 403 is the one extra case (row above).

### Logging

- `ai_calls` rows gain a `provider` field: `"groq"`, `"openrouter"` or `"gemini"`. The collection has no validator, so no migration is needed.
- `model` keeps the model id.
- Token counts come from `usage.prompt_tokens` and `usage.completion_tokens`.
- Wording that says "Gemini" in shared messages becomes "the AI".

### Deadline and fallback reserve

The 15 s deadline stays. The reserve kept for the backup becomes **per backend**:
- 4 s for Gemini (measured);
- **6 s for OpenRouter** (free hosts are slower), to be measured in the live check and tuned.

Groq usually answers in 1–3 s, so the main model keeps most of the budget.

### What does not change

- The routes, the `ideas` limit, refunds and error codes.
- `generateStoryboard` in `gemini.ts` (the M0 script; the storyboard work in F3 decides its provider).
- The Gemini path when `AI_PROVIDER=gemini`.

## Three-tier chain (added 2026-10-19)

You asked: "first I would get the results from the Gemini. If the Gemini is not available, then the backup should be Grok. And if the Grok is not available, then the backup should be Open Router."

### Settings

| `AI_PROVIDER` | Order |
|---|---|
| **`chain`** (new default; also when the setting is empty) | Gemini `GEMINI_FAST_MODEL` → Groq `GROQ_MODEL` → OpenRouter `OPENROUTER_MODEL` |
| `groq` | Groq → OpenRouter (no Gemini), as on 2026-10-18 |
| `gemini` | `GEMINI_FAST_MODEL` → `GEMINI_FALLBACK_MODEL` (Gemini only) |
| `mock` | sample data, unchanged |

- **A tier without its key is left out.** No `GEMINI_API_KEY` → Groq → OpenRouter; no `GROQ_API_KEY` → Gemini → OpenRouter; no `OPENROUTER_API_KEY` (or `OPENROUTER_MODEL` set to empty) → no third tier. With no AI key at all, the request fails with "No AI key is set…".
- The chain uses one Gemini model (`GEMINI_FAST_MODEL`); `GEMINI_FALLBACK_MODEL` is only used by `AI_PROVIDER=gemini`.
- `chain` is a new setting rather than a new meaning for `groq`, so each value says what it does, and `groq` / `gemini` still pin a single provider when you want to compare them.

### When a tier "isn't available"

The request moves on to the next tier when a tier:
- is **busy** (429 rate limit, 5xx, overloaded, network error) — the first model that fails fast gets **one quick retry** (after 1 s) per request, then the chain moves on;
- is **too slow** (its time budget below runs out) — no second try;
- is **out of quota or credits** — no second try, and the **breaker** skips it on later requests:
  - **402 / out of credits** (Gemini "prepayment credits are depleted", OpenRouter "Insufficient credits", any Groq 402): skipped for **30 min**, for every model of that provider (the whole key is out), with a loud server-log line;
  - **429 quota** (Groq per-minute or daily, OpenRouter's free daily limit, Gemini quota): skipped for the time the provider gives (`retry-after`, reset time, "try again in …"), else 30 min for a daily cap and 1 min otherwise;
  - each skip writes an `ai_calls` row (`status: "retry"`, `latencyMs: 0`, `error: "skipped: quota cooldown until …"`), once per model per request.

With today's Gemini key (402), the first request after a server start makes **one** Gemini call (a fast 402), then Groq answers in the same request. Later requests go **straight to Groq** for 30 min, with no Gemini call.

These stop the chain at once instead (no next tier): a **safety block** (`AiBlockedError` → `422 UNSAFE_CONTENT`), and a **setup error** such as a bad key (401/403). A `{"refused":true,"category":…}` reply is an ordinary answer from any tier, so the refusal categories work the same everywhere. The **repair round** stays on the tier that answered.

### Time budget (15 s overall)

Each tier keeps a **reserve**: time held back for it while an earlier tier runs.

| Tier | Reserve | Why |
|---|---|---|
| Gemini | 4 s (only used by `AI_PROVIDER=gemini`'s fallback) | measured 2026-10-17 |
| Groq | **4 s** | Groq answers our requests in 1–3 s |
| OpenRouter | **6 s** | free hosts are slower |

**Rule:** a tier runs with `time left − the next available tier's reserve`. If that would leave it less than its own reserve (an earlier tier used most of the deadline), it gets all the time that's left. Tiers that are cooling down don't count as "next". A tier with under 1 s left is skipped.

What that gives with all three keys:

| What happens | Gemini | Groq | OpenRouter |
|---|---|---|---|
| Gemini answers | up to 11 s | — | — |
| Gemini never answers | 11 s | 4 s | none left → `503` if Groq also fails |
| Gemini fails fast (e.g. 402), Groq never answers | ≈0 s | 9 s | 6 s |
| Gemini busy twice (1 s pause), Groq never answers | ≈0 s | 8 s | 6 s |
| Gemini cooling down (skipped) | 0 s | 9 s | 6 s |

Why not keep back Groq's *and* OpenRouter's reserves (10 s) while Gemini runs: Gemini would then get only 5 s, and `gemini-3.8-flash` needs 9–12 s for 5 Hindi idea cards, so it would almost always time out and the first choice would never answer. Keeping only the next tier's reserve gives Gemini the same 11 s it had before; the price is that when **both** Gemini and Groq are slow, OpenRouter has no time left (the request answers `503` and the `ideas` count is given back). When Gemini fails fast — today's case — both later tiers get their full time.

### Unchanged

Refunds on failure (`503` gives the `ideas` count back), `ai_calls` rows per attempt with `provider` and `model` (`status: "ok"` for the first tier, `"fallback"` for a later one), RECITATION retry, Groq's invalid-JSON 400 → repair round, OpenRouter moderation → `422`, and `AI_PROVIDER=mock`.

### Tests

`packages/ai/src/chain.test.ts` (mocked Gemini SDK and mocked `fetch`, fake keys only; no test calls a real AI): chain order and model settings, key-missing skips, Gemini answers first, busy Gemini → Groq → OpenRouter, the repair round staying on Groq, a Gemini safety block stopping the chain, Gemini 402 → Groq in the same request and skipped on later requests (and back after 30 min), Groq daily 429 → OpenRouter, everything cooling down → `AiBusyError`, the deadline cases in the table above, and mock mode with every key set.

### Try it live (you)

1. In `apps/web/.env.local`, set `AI_PROVIDER=chain` (or remove the line) and keep the three keys. Restart `npm run dev`.
2. Open a video → **Find a topic** → type a topic → go. You should get 5 cards. In the terminal running `npm run dev` you should see one line `[ai] gemini says the account's prepaid credits are used up … Skipping it for 30 min.`
3. Click **Use this** on a card (one brief). It should answer without a new Gemini line (Gemini is skipped).
4. Optional: in MongoDB, `ai_calls` for those two requests shows `gemini` (`retry`, the 402) then `groq` (`fallback`), and for the second request `gemini` "skipped: quota cooldown" then `groq`.

## Mock mode (added 2026-10-19)

Manual testing shouldn't use up the free limits (Groq about 60–80 calls a day, OpenRouter 50). So there's a third setting:

| Setting | What answers |
|---|---|
| `AI_PROVIDER=mock` | Sample data built from the topic you type, in the video's language (English or Hindi). No network, no key, no free limit spent. |

- **Every hook starts with `[Mock]`**, so sample text is never mistaken for real AI output.
- **Find a topic:** 5 cards from 10 templates, such as "Why ⟨topic⟩ matters more than you think". **Suggest 5 more** gives the 5 not shown yet; after all 10, the titles get a round number.
- **Briefs:** a brief (3 key points for 60 s, 4 for 90 s) plus 2 other angles. From an idea card, it keeps the card's title, hook and angle.
- **Test triggers**, so error paths can be checked without typing a harmful topic:
  - `[mock:refuse]` in the topic or idea → the refusal path (`422 UNSAFE_CONTENT`);
  - `[mock:busy]` → the AI stays busy (`503 AI_BUSY`; the request is given back).
- Replies take 0.8 s, so loading states show.
- Everything else is real: saving, the `ideas` limit and `ai_calls` rows (`provider: "mock"`).
- **Refused in production** (`NODE_ENV=production`), so sample data can never reach users.
- **How to use it:** put `AI_PROVIDER=mock` in `apps/web/.env.local` and restart `npm run dev`. Or leave the file alone and start the `web-mock` entry in `.claude/launch.json` (port 3100, mock mode for that server only). Use `groq` only for a real-quality check.
- **Automated tests never use the keys:** every test mocks `fetch` or the Gemini SDK with fake keys, and CI has no AI keys.

## Tests

Mocked `fetch` for Groq and OpenRouter; the existing mocked `@google/genai` tests for Gemini.

- `AI_PROVIDER` picks the backend. Default `groq`; unknown value → error; `gemini` → today's tests pass unchanged.
- Groq happy path: request body (system message, JSON mode, model from `GROQ_MODEL`, reasoning settings), tokens logged with `provider: "groq"`.
- Repair round: bad JSON, and a wrong shape → second call with the errors → success.
- Groq 400 invalid-JSON → repair round.
- 429 per-minute → retry/backup; 429 daily → cooldown, skipped on the next request; everything cooling down → `AiBusyError` with `retryAfterSec`.
- OpenRouter 402 → billing cooldown; 200-with-error body → treated as that error; moderation 403 → `AiBlockedError`.
- Busy main → backup used, logged as `fallback` with `provider: "openrouter"`; no `OPENROUTER_API_KEY` → no backup.
- Deadline: a slow main model leaves the backup its reserve.
- `{"refused":true}` passes through as today (covered by the ideas/brief tests).

## After it's built

1. `npx vitest run`, `npm run typecheck`, `npm run lint`.
2. Live check (after you've added the keys), with a local test account only:
   - one English and one Hindi "Find a topic";
   - one brief.
3. I compare the Hindi with the earlier Gemini output, honestly, and also try `qwen/qwen3.8-27b` on the same Hindi topic.

## Docs updated

- System Design §8.1: dev uses Groq + OpenRouter; Gemini later, on a paid plan.
- M2 Design, where it says "Gemini".
- PROJECT_STATUS: change-log line, plus the open item "paid Gemini plan before launch".

## Questions for you

1. **Main model:** `openai/gpt-oss-120b` (stable, production) — OK? Or start with `qwen/qwen3.8-27b` (often better Hindi, but preview, so Groq may remove it)? I can also decide after the live Hindi check, since it's a one-line setting.
2. **Backup model:** `google/gemma-4-31b-it:free` — OK?
3. **OpenRouter's 50 free requests a day:** fine for now? (A one-time $10 credit raises it to 1,000 a day. Not needed yet.)
