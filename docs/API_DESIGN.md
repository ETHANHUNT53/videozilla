# Videozilla — API Design (V1)

| | |
|---|---|
| **Document** | HTTP API design: conventions, authentication, resources, endpoints, errors, pagination, async jobs, webhooks |
| **Version** | 1.0 — approved 2026-10-16 (open questions use the stated defaults) |
| **Date** | 2026-10-16 |
| **Based on** | [PRD v1.3](PRD.md) · [System Design v0.1](SYSTEM_DESIGN.md) · [DB Design v0.1](DB_DESIGN.md) |
| **Base URL** | `https://<app-domain>/api/v1` (local: `http://localhost:3000/api/v1`) |

---

## Table of contents

1. [Principles](#1-principles)
2. [Conventions](#2-conventions)
3. [Authentication and authorisation](#3-authentication-and-authorisation)
4. [Requests](#4-requests)
5. [Responses](#5-responses)
6. [Pagination, filtering, sorting](#6-pagination-filtering-sorting)
7. [Errors](#7-errors)
8. [Concurrency (ETag / If-Match)](#8-concurrency-etag--if-match)
9. [Idempotency](#9-idempotency)
10. [Long-running operations](#10-long-running-operations)
11. [Rate limits and usage limits](#11-rate-limits-and-usage-limits)
12. [Resource representations](#12-resource-representations)
13. [Endpoints](#13-endpoints)
14. [Webhooks and internal endpoints](#14-webhooks-and-internal-endpoints)
15. [Event catalogue (Inngest)](#15-event-catalogue-inngest)
16. [Endpoint → state transition matrix](#16-endpoint--state-transition-matrix)
17. [Security checklist](#17-security-checklist)
18. [Versioning and deprecation](#18-versioning-and-deprecation)
19. [Open questions](#19-open-questions)

---

## 1. Principles

1. **One documented contract.** All product operations are exposed as a versioned JSON REST API under `/api/v1`. The web UI calls it from client components; server components read through the same service layer, so behaviour can't drift. A future mobile app uses the same API.
2. **Resources, not RPC**, except for explicit actions on a resource (`POST /projects/{id}/restore`), which are modelled as sub-resources.
3. **Every request is user-scoped.** The user comes only from the session; ids of other users' resources return `404`, never `403` (DB Design §1, System Design AD-13).
4. **Long work is asynchronous.** AI generation, voice builds, renders and publishing return `202 Accepted` with a **run** to poll (§10).
5. **Predictable failures.** One error format, stable machine-readable codes, and plain-language messages (§7).
6. **Safe to retry.** Idempotency keys and compare-and-set state changes make double clicks and network retries harmless (§8–§9).

---

## 2. Conventions

| Topic | Rule |
|---|---|
| Format | JSON (`application/json; charset=utf-8`) for requests and responses. UTF-8 throughout (Hindi text is plain Unicode, NFC-normalised on input). |
| Field naming | `camelCase` |
| IDs | Opaque strings (24-char hex). Clients must not parse them. Scene ids are `s1`, `s2`, … within a storyboard. |
| Timestamps | ISO 8601 UTC with milliseconds: `2026-10-16T09:30:00.000Z`. Schedules take ISO 8601 with an offset or `Z`; the server stores UTC. |
| Enums | lower `snake_case` strings (DB Design §5) |
| Nulls | Optional fields that have no value are returned as `null` (not omitted) in resource bodies, so shapes are stable. |
| Booleans | `true` / `false` only |
| Durations | `…Ms` (milliseconds) or `…Sec` (seconds), named explicitly |
| Languages | `en`, `hi` |
| Empty collections | `[]`, never `null` |
| Unknown fields in requests | Rejected with `400 VALIDATION_FAILED` (strict schemas), so typos surface early |
| Trailing slashes | Not used; `/projects/` redirects 308 to `/projects` |
| Request ID | Every response has `X-Request-Id` (generated, or echoed if the client sent a valid one); also present in error bodies for support |

---

## 3. Authentication and authorisation

### 3.1 Mechanism

- **Session cookie** issued by Better Auth: `better-auth.session_token` (`__Secure-` prefix in production). It is httpOnly, Secure, `SameSite=Lax`, `Path=/`, with a 30-day rolling expiry (System Design §13.1).
- Browser clients send it automatically (`credentials: "same-origin"`). There are no bearer tokens in V1.
- **Every `/api/v1` endpoint requires a valid session** unless marked *public*.
- **Email must be verified.** A signed-in but unverified user gets `403 EMAIL_NOT_VERIFIED` on every `/api/v1` endpoint except `GET /me`.

### 3.2 CSRF protection

- Cookies are `SameSite=Lax`, so cross-site `POST`/`PATCH`/`DELETE` don't carry the session.
- In addition, every unsafe method (`POST`, `PUT`, `PATCH`, `DELETE`) on `/api/v1` must have an `Origin` header matching the app's origin, otherwise `403 ORIGIN_NOT_ALLOWED`. Better Auth applies the same check (`trustedOrigins`) to `/api/auth/*`.

### 3.3 Auth endpoints (Better Auth, base `/api/auth`)

These endpoints are provided by Better Auth and documented here as a contract. Their error format is Better Auth's own (`{ code, message }`), which the client normalises.

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| POST | `/sign-up/email` | `{ name, email, password, callbackURL }` | `200 { token: null, user }` | Sends a verification email; no session until verified |
| POST | `/sign-in/email` | `{ email, password, callbackURL?, rememberMe? }` | `200 { redirect, token, user }` + Set-Cookie | `403` if the email isn't verified (a fresh verification email is sent) |
| POST | `/sign-in/social` | `{ provider: "google", callbackURL, errorCallbackURL? }` | `200 { url, redirect: true }` | The browser follows `url` to Google; the callback is `/api/auth/callback/google` |
| POST | `/sign-out` | `{}` | `200 { success: true }` | Clears the cookie |
| GET | `/get-session` | — | `200 { session, user } \| null` | Used by the UI on load |
| POST | `/send-verification-email` | `{ email, callbackURL }` | `200 { status: true }` | Rate-limited |
| GET | `/verify-email?token=…&callbackURL=…` | — | `302` to `callbackURL` (signed in) | Link from the email |
| POST | `/request-password-reset` | `{ email, redirectTo }` | `200 { status: true }` | **Same response whether or not the email exists** |
| POST | `/reset-password` | `{ newPassword, token }` | `200 { status: true }` | Revokes all other sessions |
| POST | `/delete-user` | `{ callbackURL? }` | `200 { success: true }` | Needs a fresh session (< 24 h). Starts account deletion (DB Design §6.12) |
| GET | `/list-sessions` | — | `200 Session[]` | Settings → "signed-in devices" (P1) |
| POST | `/revoke-other-sessions` | `{}` | `200 { status: true }` | "Sign out of other devices" |

**Password rules:** 8–128 characters. **Rate limits** (Better Auth built-in): sign-in and sign-up 10 per minute per IP; verification and reset emails 3 per hour per email.

### 3.4 Roles

| Role | Access |
|---|---|
| `user` | Own resources only |
| `admin` | Additionally `/api/v1/admin/*` (M7), **metadata only** (DB Design D5) |

### 3.5 Machine-to-machine

| Caller | Endpoint | Authentication |
|---|---|---|
| Inngest | `/api/inngest` | Inngest request signature (`INNGEST_SIGNING_KEY`) |
| Meta (Instagram) | `/api/webhooks/instagram/*` | `signed_request` HMAC-SHA256 with the app secret |
| Render agent | No HTTP API — talks to MongoDB / R2 / Inngest with restricted credentials | DB Design §13.1 |

---

## 4. Requests

| Header | When | Purpose |
|---|---|---|
| `Content-Type: application/json` | bodies | Required; anything else → `415 UNSUPPORTED_MEDIA_TYPE` |
| `Origin` | unsafe methods | CSRF check (§3.2) |
| `If-Match: "<rev>"` | `PATCH` on projects, idea, publish jobs | Optimistic concurrency (§8) |
| `Idempotency-Key: <uuid>` | job-starting and publish `POST`s | Safe retries (§9) |
| `X-Request-Id` | optional | Correlation (≤ 64 chars `[A-Za-z0-9-]`) |

**Body size limits:**

| Endpoint | Limit |
|---|---|
| Default | 64 KB |
| `PUT /projects/{id}/idea` (pasted notes, ≤ 20,000 chars) | 128 KB |
| Anything larger | `413 PAYLOAD_TOO_LARGE` |

**Validation:**
- Every body, query and path parameter is validated with the Zod schemas in `packages/schema`.
- Strings are trimmed and NFC-normalised.
- Control characters other than `\n` and `\t` are rejected.

---

## 5. Responses

### 5.1 Success shapes

| Case | Status | Body |
|---|---|---|
| Get one resource | `200` | the resource object |
| Create a resource | `201` + `Location` | the created resource |
| Start async work | `202` + `Location: /api/v1/runs/{id}` | `{ run, project }` (§10) |
| Update | `200` | the updated resource (new `ETag`) |
| Delete / action with nothing to return | `200` | `{ ok: true, … }` with the useful bits (e.g. `restoreUntil`) |
| List | `200` | `{ items: [...], nextCursor, hasMore }` (§6) |

No envelope around single resources. Every resource object includes `id`, `createdAt` and `updatedAt`. Editable resources also include `rev` and send `ETag: "<rev>"`.

### 5.2 Caching headers

- Authenticated responses: `Cache-Control: private, no-store`.
- `GET /config`: `Cache-Control: private, max-age=300`.
- Signed media URLs carry their own expiry (`expiresAt` in the body).

---

## 6. Pagination, filtering, sorting

### 6.1 Cursor pagination (all list endpoints)

- **Request:** `?limit=<1–100, default 24>&cursor=<opaque>`.
- **Response:**

```json
{
  "items": [ /* … */ ],
  "nextCursor": "eyJ1IjoiMjAyNi0xMC0xNlQwOToyNjozMC4wMDBaIiwiaSI6IjZhZDIwZjI4In0",
  "hasMore": true
}
```

- **How the cursor works:**
  - It's an opaque base64url string of the sort key of the last item plus `_id` as a tie-breaker, e.g. `{u: updatedAt, i: id}`.
  - Clients pass `nextCursor` back unchanged.
  - When `hasMore` is `false`, `nextCursor` is `null`.
  - A cursor is only valid with the same filters and sort it was created with; a mismatch → `400 INVALID_CURSOR`.
- **Stability:** cursors (unlike page numbers) don't skip or repeat items when new projects are created while paging.
- **No total counts** on large lists (they're expensive). Counts that the UI needs are separate fields, e.g. `GET /notifications/unread-count`.

### 6.2 Filtering and search

- **Filters:** plain query parameters with enum values, e.g. `?filter=drafts`, `?status=exported`.
- **Search:** `?q=` matches titles case-insensitively, 1–80 characters, on `GET /projects`.
- **Invalid parameters:** an unknown filter value → `400 VALIDATION_FAILED` with `details[].field`.

### 6.3 Sorting

- Lists have one documented default sort.
- `?sort=` is accepted only where listed, as `field` or `-field` (descending).
- The default for projects is `-updatedAt`.

---

## 7. Errors

### 7.1 Format

```json
{
  "error": {
    "code": "INVALID_STATE",
    "message": "This video is still rendering. Try again when it's done.",
    "details": [{ "field": "status", "issue": "current status is 'rendering'" }],
    "requestId": "req_7f3a9c2e",
    "retryable": false,
    "retryAfterSec": null,
    "docs": "https://<app-domain>/docs/errors#INVALID_STATE"
  }
}
```

| Field | Meaning |
|---|---|
| `code` | Stable identifier. Clients branch on this, never on `message`. |
| `message` | Plain English for the user (Hindi UI later). |
| `details` | Field-level problems: `{ field, issue }`. For conflicts, may include `current`, the latest resource. |
| `requestId` | Matches `X-Request-Id`; quoted in support. |
| `retryable` | Whether repeating the same request may succeed. |
| `retryAfterSec` | For `429` / `503`; also sent as the `Retry-After` header. |

Internal details (stack traces, provider payloads, database errors) are **never** returned; they go to Sentry with the `requestId`.

### 7.2 Error catalogue

| HTTP | Code | When | Retryable |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | Body, query or path parameter fails the schema | no |
| 400 | `INVALID_CURSOR` | Bad or mismatched pagination cursor | no |
| 401 | `UNAUTHENTICATED` | No or expired session | no |
| 403 | `EMAIL_NOT_VERIFIED` | Session exists but the email isn't verified | no |
| 403 | `ORIGIN_NOT_ALLOWED` | CSRF origin check failed | no |
| 403 | `FORBIDDEN` | Role not allowed (admin endpoints only) | no |
| 404 | `NOT_FOUND` | Resource doesn't exist **or belongs to another user** | no |
| 405 | `METHOD_NOT_ALLOWED` | — | no |
| 409 | `INVALID_STATE` | The action isn't allowed in the project's current status (DB Design §5.2); `details.current` has the status | no |
| 409 | `RUN_IN_PROGRESS` | An active run of the same kind exists; body includes the run | no (poll it) |
| 409 | `PUBLISH_IN_PROGRESS` | Delete or edit while an Instagram post is being published | yes, later |
| 409 | `ALREADY_POSTED` | The project was already posted (one post per project) | no |
| 409 | `EXPORT_OUTDATED` | Publishing a video whose storyboard changed after export, without `waitForNewExport` | no |
| 409 | `INSTAGRAM_ALREADY_LINKED` | That Instagram account is connected to another Videozilla user | no |
| 409 | `INSTAGRAM_NOT_CONNECTED` | Publishing without a connected Instagram account | no (connect first) |
| 409 | `IG_RECONNECT_REQUIRED` | The connected account's token is invalid or revoked | no (reconnect first) |
| 412 | `PRECONDITION_FAILED` | `If-Match` doesn't match the current `rev`; `details.current` = latest resource | no (reload) |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the limit | no |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Not JSON | no |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Same `Idempotency-Key` with a different body | no |
| 422 | `UNSAFE_CONTENT` | Topic, notes or revision blocked by the safety policy (PRD §21); `details.category` | no |
| 422 | `INSTAGRAM_NOT_ELIGIBLE` | Personal account / missing publish permission | no |
| 422 | `SCHEDULE_OUT_OF_RANGE` | `scheduledAt` < now + 10 min or > now + 75 d | no |
| 422 | `CAPTION_INVALID` | > 2,200 characters, > 30 hashtags or > 20 mentions | no |
| 429 | `RATE_LIMITED` | Too many requests in a short window | yes (`Retry-After`) |
| 429 | `LIMIT_REACHED` | Daily usage limit (PRD §20.6); `details.counter`, `details.resetsAt` | yes, after reset |
| 500 | `INTERNAL` | Unexpected error | yes |
| 502 | `UPSTREAM_FAILED` | Gemini, ElevenLabs, Instagram or R2 returned an error on a synchronous call | yes |
| 503 | `AI_BUSY` | Gemini busy after retries and fallback (synchronous idea endpoints) | yes (`Retry-After`) |
| 503 | `VOICE_PLAN_REQUIRED` | The approved ElevenLabs voices need a paid plan (System Design §9.1) | no (admin action) |
| 503 | `MAINTENANCE` | Planned maintenance | yes |

**Errors inside async runs** use the same codes in `run.error` (§10.2). Run-only codes:

| Code | Meaning | Retryable |
|---|---|---|
| `RENDER_AGENT_OFFLINE` | No render agent picked up the job within its waiting window | yes |
| `RENDER_FAILED` | The render or its output check failed | yes |
| `IG_RECONNECT_REQUIRED` | Instagram token is invalid or revoked | no, until reconnected |
| `IG_QUOTA_EXCEEDED` | Instagram's publishing limit for the account is used up | yes, later |
| `IG_CONTAINER_ERROR` | Instagram rejected the media container | yes |
| `STORYBOARD_INVALID` | Gemini output still invalid after repair attempts | yes |
| `DURATION_UNFIT` | The video couldn't be fitted to its target length | no |

---

## 8. Concurrency (ETag / If-Match)

- Editable resources (`Project`, `IdeaSession`, `PublishJob`) carry `rev` and the header `ETag: "<rev>"`.
- `PATCH`/`PUT` on them **should** send `If-Match: "<rev>"`.
  - If it matches: the update applies, `rev` increments, and the response has the new `ETag`.
  - If it doesn't: `412 PRECONDITION_FAILED` with the current resource in `details.current`. The UI shows "This video was updated in another tab".
  - If `If-Match` is missing: the update applies last-write-wins (allowed for simple fields such as `title`).
- **State changes** (generate, approve, export, publish…) don't use `If-Match`. They're compare-and-set on the status (DB Design §5), and illegal transitions return `409 INVALID_STATE`.

---

## 9. Idempotency

| Endpoint | Mechanism | Window |
|---|---|---|
| `POST /projects/{id}/storyboard/generate`, `/builds`, `/renders`, `/runs/{id}/retry` | Server-derived key `{projectId}:{kind}:{version\|renderId\|attempt}` → returns the existing run | lifetime of the run |
| `POST /projects/{id}/publish-jobs` | **Required** `Idempotency-Key` header (UUID v4) → unique `publish_jobs.idempotencyKey` | permanent |
| `POST /projects/{id}/idea/chat`, `/revisions` | `clientMessageId` (UUID v4) in the body → unique per project | permanent |
| `POST /projects` | Not idempotent (a duplicate draft is harmless and deletable) | — |

**Behaviour:**
- **Same key + same request:** the original result is returned with the original status code, plus `Idempotent-Replayed: true`.
- **Same key + different body:** `422 IDEMPOTENCY_KEY_REUSED`.

---

## 10. Long-running operations

### 10.1 Pattern

```
POST /api/v1/projects/{id}/builds          → 202 Accepted
Location: /api/v1/runs/{runId}
{ "run": { …queued run… }, "project": { …status: "building"… } }

GET /api/v1/projects/{id}/status           → poll every 2 s while any run is active
```

- The UI polls **one** endpoint per project (`/projects/{id}/status`). It returns the project status plus all active runs, and stops polling when nothing is active.
- When a run finishes, the next poll shows it in `lastRuns` with `succeeded`/`failed`, and the project's new status. The UI then refetches the affected resource (storyboard, timeline, render…).
- Clients may also fetch `GET /runs/{runId}` directly.

### 10.2 Run representation

```json
{
  "id": "6ad2…",
  "projectId": "6ad1…",
  "kind": "build",
  "status": "running",
  "active": true,
  "progress": 46,
  "steps": [
    { "name": "plan_speed", "label": "Planning narration speed", "status": "succeeded", "attempt": 1 },
    { "name": "voice", "label": "Recording voiceover (scene 3 of 7)…", "status": "running", "attempt": 1, "progress": 40 },
    { "name": "timeline", "label": "Syncing animations to the voice…", "status": "pending", "attempt": 0 }
  ],
  "error": null,
  "etaSec": 35,
  "startedAt": "2026-10-16T09:30:01.000Z",
  "finishedAt": null,
  "createdAt": "2026-10-16T09:30:00.000Z",
  "updatedAt": "2026-10-16T09:30:20.000Z"
}
```

- `status`: `queued | running | succeeded | failed | cancelled`.
- `progress`: 0–100, an overall estimate.
- `label`: user-facing step text (PRD §16.5).
- `etaSec`: from historical medians; `null` when unknown.

On failure:

```json
"error": { "code": "VOICE_PLAN_REQUIRED", "message": "…", "retryable": false, "step": "voice" }
```

---

## 11. Rate limits and usage limits

| Kind | Scope | Limit | Response |
|---|---|---|---|
| Short-window rate limit | per user (per IP when signed out) | 120 requests/min overall; 20/min on AI endpoints (`/idea/*`, `/storyboard/generate`, `/revisions`) | `429 RATE_LIMITED` + `Retry-After`. Enforced at the edge (Vercel Firewall rules). |
| Daily usage limits | per user, per IST day | storyboards 20 · revisions 100 (and 50 per project) · builds 15 · renders 10 · AI illustrations 40 (PRD §20.6) | `429 LIMIT_REACHED` with `details: { counter, limit, used, resetsAt }`. Checked atomically when the run is created (DB Design §7.5). |

Responses from limited endpoints include `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers (IETF draft format) for the daily counters, so the UI can show "2 renders left today" when close to the limit.

---

## 12. Resource representations

Shapes are defined as TypeScript types; the Zod schemas in `packages/schema` are the source of truth.

```ts
type Language = "en" | "hi";
type VoiceGender = "female" | "male";
type ProjectStatus =
  | "idea_draft" | "storyboard_generating" | "storyboard_ready" | "building" | "preview_ready"
  | "rendering" | "exported" | "scheduled" | "publishing" | "posted" | "publish_failed" | "needs_attention";

interface Me {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: string };
  profile: Profile;
  instagram: InstagramAccount | null;
}

interface Profile {
  displayName: string;
  defaultLanguage: Language;
  defaultLengthPreset: 60 | 90;
  defaultVoiceGender: VoiceGender;
  defaultStyleId: string;
  defaultAudience: "kids" | "students" | "college" | "general";
  defaultBoardOrExam: "cbse" | "icse" | "state" | "jee" | "neet" | "upsc" | null;
  timezone: string;
  emailNotifications: boolean;
  about: string | null;            // "What do you teach or create about?" (≤ 200 chars)
  onboardingCompleted: boolean;
  updatedAt: string;
}

interface ProjectSummary {           // list item
  id: string; title: string; language: Language; lengthPreset: 60 | 90;
  status: ProjectStatus; coverUrl: string | null;   // signed, 10 min
  exportOutdated: boolean; postedAt: string | null;
  createdAt: string; updatedAt: string; rev: number;
}

interface Project extends ProjectSummary {           // detail
  audience: string; boardOrExam: string | null; styleId: string;
  voiceGender: VoiceGender; captionsEnabled: boolean;
  attention: { kind: "storyboard" | "build" | "render" | "publish"; step: string; errorCode: string; message: string; at: string } | null;
  currentStoryboardVersion: number | null;
  latestRender: Render | null;
  activePublishJob: PublishJob | null;
  permalink: string | null;
  revisionCount: number;
  allowedActions: AllowedAction[];   // computed from DB Design §5.2, drives which buttons are enabled
}
type AllowedAction = "edit_idea" | "generate" | "revise" | "approve" | "retry" | "export" | "publish" | "schedule"
  | "edit_schedule" | "cancel_schedule" | "rename" | "delete" | "duplicate";

interface IdeaSession {
  projectId: string; mode: "topic" | "idea" | "notes";
  topicInput: string; ideaInput: string; notesText: string;
  suggestions: { id: string; title: string; hook: string; angle: string; keyPoints: string[] }[];
  brief: { title: string; hook: string; angle: string; audience: string; keyPoints: string[]; outOfScope: string[] } | null;
  briefAlternatives: NonNullable<IdeaSession["brief"]>[];   // the 2 other angles that came with the brief (F2.3)
  briefUpdatedAt: string | null;   // when the brief last changed; sent back with "Use this angle" (F2.3)
  rev: number; updatedAt: string;
}

interface ChatMessage {
  id: string; thread: "idea" | "revision"; role: "user" | "assistant"; content: string;
  scopeSceneId: string | null;
  status: "pending" | "processing" | "applied" | "clarification" | "unsupported" | "failed" | "undone";
  clarification: { question: string; options: string[] } | null;
  changedSceneIds: string[]; versionBefore: number | null; versionAfter: number | null;
  canUndo: boolean; createdAt: string;
}

interface StoryboardVersion {
  version: number; source: "generate" | "revision" | "manual_edit" | "restore" | "duplicate";
  basedOnVersion: number | null; changeSummary: string; changedSceneIds: string[];
  storyboard: Storyboard;                       // System Design §7.1
  estimatedDurationSec: number; wordCount: number;
  warnings: string[];
  accuracyFlags: { sceneId: string; claim: string; note: string }[];
  isCurrent: boolean; createdAt: string;
}

interface PreviewTimeline {                     // for the in-browser Remotion Player
  timelineId: string; storyboardVersion: number; durationMs: number;
  timeline: Timeline;                           // System Design §7.2, with audioKey replaced by signed audioUrl
  urlsExpireAt: string;                         // refetch before this (URLs valid 60 min)
  syncReport: { exact: number; fuzzy: number; proportional: number; default: number };
}

interface Render {
  id: string; status: "queued" | "rendering" | "uploading" | "exported" | "failed" | "cancelled";
  progress: number; isLatest: boolean; durationMs: number | null; sizeBytes: number | null;
  coverUrl: string | null; queuePosition: number | null; createdAt: string; updatedAt: string;
}

interface PublishJob {
  id: string; status: "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  mode: "now" | "scheduled"; scheduledAt: string | null; caption: string; shareToFeed: boolean;
  waitForNewExport: boolean; permalink: string | null;
  error: { code: string; message: string } | null; rev: number; createdAt: string; updatedAt: string;
}

interface InstagramAccount {
  id: string; username: string; accountType: "BUSINESS" | "MEDIA_CREATOR"; profilePicUrl: string;
  status: "active" | "needs_reconnect"; connectedAt: string;     // tokens are never returned
}

interface Notification {
  id: string; type: string; title: string; body: string; projectId: string | null; read: boolean; createdAt: string;
}
```

---

## 13. Endpoints

Every endpoint requires a session and a verified email unless marked otherwise. Each one lists the request, the success response and its specific errors; the common errors (`401`, `403 EMAIL_NOT_VERIFIED`, `404`, `400 VALIDATION_FAILED`, `429`, `500`) apply everywhere and aren't repeated.

### 13.1 Me, profile, usage, config

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/me` | — | `200 Me` (works for unverified users) |
| PATCH | `/me/profile` | partial `Profile` (editable fields, incl. `about`), plus `onboardingCompleted: true` to finish / skip onboarding (can't be undone) | `200 Profile` |
| GET | `/me/usage` | — | `200 { date, resetsAt, counters: { storyboards: { used, limit }, revisions: {…}, builds: {…}, renders: {…}, illustrations: {…} } }` |
| GET | `/config` | — | `200 Config` |

`Config` includes:
- `languages`, `lengthPresets`, `audiences`, `boardsAndExams`;
- `styles` (`[{ id: "midnight", name, previewUrl }]`);
- `voices` (`[{ gender: "female", label: "Female voice", sampleUrl }, { gender: "male", … }]` — **only the two approved voices**; voice ids are never exposed);
- `limits`, and `features` flags.

### 13.2 Projects

#### `GET /projects` — list

| Query | Values | Default |
|---|---|---|
| `filter` | `all` · `drafts` · `ready` · `scheduled` · `posted` · `attention` | `all` |
| `q` | title search, 1–80 chars | — |
| `limit` / `cursor` | §6 | 24 |

- **Sort:** `-updatedAt` (ties broken by `-id`).
- **Response:** `200 { items: ProjectSummary[], nextCursor, hasMore }`.

#### `POST /projects` — create

Request (all optional; defaults come from the profile):

```json
{ "title": "Why is the sky blue?", "language": "hi", "lengthPreset": 60, "voiceGender": "female" }
```

Response: `201 Project` (`status: "idea_draft"`), `Location: /api/v1/projects/{id}`. Creates the project and its idea session in one transaction (DB Design §6.1).

#### `GET /projects/{id}` — detail

`200 Project` with `ETag`.

#### `PATCH /projects/{id}` — update settings

- **Editable fields:** `title`, `language`, `lengthPreset`, `audience`, `boardOrExam`, `voiceGender`, `captionsEnabled`.
- **Headers:** `If-Match` recommended.
- **Rules:**
  - `title` can change in any status.
  - `language` / `lengthPreset` / `audience` only in `idea_draft` or `storyboard_ready`. In `storyboard_ready` the response includes `"requiresRegeneration": true`; the change applies to the next generation.
  - `voiceGender` / `captionsEnabled` in `storyboard_ready`, `preview_ready` or `exported`. On `preview_ready`/`exported` it marks `exportOutdated` and needs a rebuild (voice) or re-export (captions).
- **Errors:** `409 INVALID_STATE`, `412 PRECONDITION_FAILED`.

#### `DELETE /projects/{id}` — soft delete

- **Response:** `200 { ok: true, restoreUntil: "2026-11-15T…Z", cancelled: { runs: 1, scheduledPosts: 0 } }`.
- Cancels active runs and scheduled posts (DB Design §6.6).
- **Errors:** `409 PUBLISH_IN_PROGRESS`.
- Deleting an already-deleted project returns the same `200` (idempotent).

#### `POST /projects/{id}/restore` — undo delete

`200 Project`. Works until `purgeAt`, after which it returns `404`.

#### `POST /projects/{id}/duplicate`

- **Response:** `201 Project` (the copy: same settings, idea and current storyboard as version 1; no renders or posts).
- Available in any status, including `posted` (PRD: re-post via duplicate).

### 13.3 Idea Studio

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/projects/{id}/idea` | — | `200 IdeaSession` + `ETag` | |
| PUT | `/projects/{id}/idea` | `{ mode, topicInput?, ideaInput?, notesText? }` | `200 IdeaSession` | Autosave (debounced 800 ms). `If-Match` recommended. Allowed in `idea_draft`, `storyboard_ready`. `notesText` ≤ 20,000 chars. |
| POST | `/projects/{id}/idea/suggestions` | `{ topic, audience?, avoidTitles?: string[] }` | `200 { suggestions: [5] }` | Synchronous, ≤ 15 s. Errors: `503 AI_BUSY`, `422 UNSAFE_CONTENT`. |
| POST | `/projects/{id}/idea/brief` | `{ from: "idea" \| "notes" \| "suggestion", suggestionId? }`, or `{ from: "alternative", index: 0 \| 1, briefUpdatedAt? }` | `200 { brief, alternatives: [2], briefUpdatedAt, project }` | Saves the brief to the idea session. The project title follows the brief title until the user names the video (PRD F2-FR11), hence `project`. `idea` / `suggestion`: synchronous AI call (≤ 15 s, `ideas` limit). `alternative`: swaps in one of the 2 other angles (no AI call, not counted); with `briefUpdatedAt` (the brief the user saw), a request whose brief has changed meanwhile swaps nothing and returns the current brief, so a retry or a second tab can't swap it back. Errors: `400` (empty idea, unknown card or angle; `notes` until F2.4), `409 INVALID_STATE`, `422 UNSAFE_CONTENT`, `429`, `503 AI_BUSY`. (F2.3) |
| PATCH | `/projects/{id}/idea/brief` | partial brief (`title`, `keyPoints`, …) | `200 IdeaSession` | Direct edits (PRD F2-FR7) |
| GET | `/projects/{id}/idea/chat` | `?limit&cursor` | `200 { items: ChatMessage[], … }` | Oldest → newest |
| POST | `/projects/{id}/idea/chat` | `{ clientMessageId, content }` | `200 { userMessage, assistantMessage, brief }` | Synchronous refine (≤ 15 s); idempotent on `clientMessageId` |

**Streaming (P1):** `POST …/suggestions` and `…/idea/chat` may answer `text/event-stream` when the request sends `Accept: text/event-stream`. Events: `delta` (partial text), `result` (the final JSON above), `error` (the §7 format).

### 13.4 Storyboard

#### `POST /projects/{id}/storyboard/generate` → `202`

- **Request:** `{}`, or `{ "regenerate": true }` from `storyboard_ready`.
- **Allowed from:** `idea_draft` (needs a brief), `storyboard_ready`.
- **Response:** `202 { run, project }` (`project.status: storyboard_generating`).
- **Errors:**
  - `409 INVALID_STATE`
  - `409 RUN_IN_PROGRESS`
  - `422 VALIDATION_FAILED` (no brief yet)
  - `429 LIMIT_REACHED` (storyboards)
  - `422 UNSAFE_CONTENT` (detected up front)

#### `GET /projects/{id}/storyboard` — current version

`200 StoryboardVersion`, or `404` if none yet.

#### `GET /projects/{id}/storyboard/versions` — history

`?limit&cursor`, newest first → `200 { items: StoryboardVersionSummary[] }`, where the summary is `{ version, source, changeSummary, createdAt, isCurrent }`.

#### `GET /projects/{id}/storyboard/versions/{version}`

`200 StoryboardVersion`.

#### `POST /projects/{id}/storyboard/versions/{version}/restore`

- **Response:** `201 StoryboardVersion` (a new version copied from `{version}`, `source: restore`) + `project`.
- **Allowed in:** `storyboard_ready`, `preview_ready`, `exported`. On the last two it starts an incremental build → the response also includes `run`.

#### Manual scene edits (P1, PRD F3-FR7)

Each edit creates a new version.

| Method | Path | Request |
|---|---|---|
| PATCH | `/projects/{id}/storyboard/scenes/{sceneId}` | `{ narration?, props?, beats? }` + `If-Match: "<currentStoryboardVersion>"` |
| DELETE | `/projects/{id}/storyboard/scenes/{sceneId}` | `If-Match` (minimum 3 scenes → `409 INVALID_STATE`) |
| POST | `/projects/{id}/storyboard/scenes/{sceneId}/move` | `{ afterSceneId: string \| null }` |
| POST | `/projects/{id}/storyboard/scenes/{sceneId}/regenerate` | `{ instruction?: string }` → `202 { run }` |

- **Response** (for the synchronous ones): `201 StoryboardVersion`.
- Edited props are validated against the scene type's schema → `400 VALIDATION_FAILED` with `details[].field = "props.items[2].text"`.

### 13.5 Revisions (chat)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/projects/{id}/revisions` | `?limit&cursor` | `200 { items: ChatMessage[] }` (thread `revision`, oldest → newest) |
| POST | `/projects/{id}/revisions` | `{ clientMessageId, content, scopeSceneId? }` | `202 { message, run, queued: boolean }` |
| POST | `/projects/{id}/revisions/{messageId}/undo` | — | `201 { storyboardVersion, project, run? }` |

**`POST /revisions`:**
- **Allowed in:** `storyboard_ready`, `preview_ready`, `exported`.
- In `building`/`rendering` it is accepted with `queued: true` and runs afterwards (DB Design §5.2).
- The assistant reply arrives as a new `ChatMessage` when the run finishes: `applied`, `clarification` (with `options` for quick-reply chips) or `unsupported`.
- **Errors:**
  - `409 INVALID_STATE` (e.g. `posted`)
  - `429 LIMIT_REACHED` (`revisions` per day, or `revisions_per_project`)
  - `422 UNSAFE_CONTENT`

**`POST /revisions/{messageId}/undo`:** only the latest applied revision (`canUndo: true`). Otherwise `409 INVALID_STATE` with message "Only the most recent change can be undone — use version history".

### 13.6 Build and preview

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/projects/{id}/builds` | `{}` | `202 { run, project }` — "Approve & create video" |
| GET | `/projects/{id}/timeline` | — | `200 PreviewTimeline` |

**`POST /builds`:**
- **Allowed from:** `storyboard_ready`; also from `preview_ready`/`exported` when voice settings changed.
- Only changed scenes are re-voiced (cache, DB Design §4.7).
- **Errors:**
  - `409 INVALID_STATE`
  - `409 RUN_IN_PROGRESS`
  - `429 LIMIT_REACHED` (builds)
  - `503 VOICE_PLAN_REQUIRED` (checked up front if the last voice call returned 402)

**`GET /timeline`:** available when the project has a current timeline (`preview_ready` and later). Signed audio URLs expire in 60 min (`urlsExpireAt`); the player refetches before expiry.

### 13.7 Runs and status

| Method | Path | Response |
|---|---|---|
| GET | `/projects/{id}/status` | `200 { project: { id, status, rev, exportOutdated, attention }, activeRuns: Run[], lastRuns: Run[] (≤ 5), renderQueue: { position, agentOnline } \| null, pollAfterMs: 2000 \| null }` |
| GET | `/runs/{runId}` | `200 Run` |
| POST | `/runs/{runId}/cancel` | `200 { run, project }` |
| POST | `/runs/{runId}/retry` | `202 { run, project }` |

- **`/status`:** `pollAfterMs` is `null` when nothing is active, telling the UI to stop polling.
- **`/cancel`:** works for `queued`/`running` runs of kind `storyboard`, `build`, `render`. It moves the project back to its previous stable status (DB Design §5.1). Cancelling a finished run → `409 INVALID_STATE`.
- **`/retry`:** for `failed` runs with `retryable: true`. Resumes from the failed step (PRD F10-FR6). A non-retryable failure → `409 INVALID_STATE` with the reason.

### 13.8 Renders (export and download)

| Method | Path | Response |
|---|---|---|
| POST | `/projects/{id}/renders` | `202 { run, render, project }` |
| GET | `/projects/{id}/renders` | `200 { items: Render[] }` (newest first; includes superseded ones until purged) |
| GET | `/renders/{renderId}` | `200 Render` |
| GET | `/renders/{renderId}/download` | `200 { url, expiresAt, fileName, sizeBytes }` |
| GET | `/renders/{renderId}/cover` | `200 { url, expiresAt }` |

**`POST /renders`:**
- **Allowed from:** `preview_ready`, `exported` (re-export), `needs_attention` (kind `render`).
- **Errors:** `409 INVALID_STATE`, `409 RUN_IN_PROGRESS`, `429 LIMIT_REACHED` (renders).
- `render.queuePosition` shows the place in the local render queue.

**`/download`:** the URL is signed for 10 min with `Content-Disposition: attachment; filename="<title>.mp4"`. It's generated on each call, so there are no stale links.

### 13.9 Instagram connection

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/instagram/connect?returnTo=/settings` | session | `302` to Instagram's consent page. Creates a signed, single-use `state` (10 min) bound to the session and `returnTo` (same-site path only). |
| GET | `/instagram/callback?code&state` | session + `state` | Exchanges the code → long-lived token → checks the account type and scopes → stores it encrypted. `302` to `returnTo?instagram=connected`, or `?instagram_error=<code>` (`not_eligible`, `permission_denied`, `cancelled`, `already_linked`, `failed`). |
| GET | `/me/instagram` | session | `200 InstagramAccount \| null` |
| GET | `/me/instagram/quota` | session | `200 { used, limit, resetsAt }` (Instagram content-publishing limit) |
| DELETE | `/me/instagram` | session | `200 { ok: true, cancelledScheduledPosts: n }`. Revokes locally and cancels scheduled posts (DB Design §6.10). `409 PUBLISH_IN_PROGRESS` while a post is uploading. |

### 13.10 Publishing

#### `POST /projects/{id}/publish-jobs` — post now or schedule

Headers: **`Idempotency-Key` required**.

```json
{
  "mode": "scheduled",
  "scheduledAt": "2026-10-18T13:30:00+05:30",
  "caption": "Why is the sky blue? 🌅 …",
  "shareToFeed": true,
  "waitForNewExport": false
}
```

- **Response:**
  - `mode: "now"` → `202 { publishJob, run, project }` (`project.status: publishing`)
  - `mode: "scheduled"` → `201 { publishJob, project }` (`project.status: scheduled`)
- **Allowed from:** `exported`; `publish_failed` (as a retry or reschedule).
- **Errors:**

| Status | Code | When |
|---|---|---|
| 409 | `INVALID_STATE` | |
| 409 | `ALREADY_POSTED` | |
| 409 | `EXPORT_OUTDATED` | storyboard changed after export, `waitForNewExport` false |
| 409 | `RUN_IN_PROGRESS` | active publish job |
| 422 | `CAPTION_INVALID` | |
| 422 | `SCHEDULE_OUT_OF_RANGE` | |
| 422 | `INSTAGRAM_NOT_ELIGIBLE` | |
| 409 | `INSTAGRAM_NOT_CONNECTED` | no account connected |
| 409 | `IG_RECONNECT_REQUIRED` | needs reconnect |
| 429 | `LIMIT_REACHED` | `counter: "instagram_quota"`, with `resetsAt` so the UI can offer to schedule after it |

#### Other publishing endpoints

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/projects/{id}/publish-jobs` | `?limit&cursor` | `200 { items: PublishJob[] }` |
| PATCH | `/publish-jobs/{jobId}` | `{ caption?, scheduledAt?, shareToFeed?, waitForNewExport? }` + `If-Match` | `200 PublishJob` |
| DELETE | `/publish-jobs/{jobId}` | — | `200 { publishJob, project }` |
| POST | `/publish-jobs/{jobId}/retry` | — | `202 { publishJob, run }` |

- **`PATCH`:** only while `scheduled` and more than 5 min before `scheduledAt`, otherwise `409 INVALID_STATE`. Errors: `412 PRECONDITION_FAILED`, the same `422`s as create.
- **`DELETE`** (cancel a scheduled post): `409 PUBLISH_IN_PROGRESS` if it's already uploading.
- **`/retry`:** for `failed` jobs.

### 13.11 Notifications

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/notifications` | `?limit&cursor&unread=true` | `200 { items: Notification[], nextCursor, hasMore }` |
| GET | `/notifications/unread-count` | — | `200 { count }` |
| POST | `/notifications/read` | `{ ids: string[] }` or `{ all: true }` | `200 { updated: n }` |

### 13.12 Admin (M7, role `admin`)

| Method | Path | Response |
|---|---|---|
| GET | `/admin/runs?status=failed&kind=render` | runs across users (metadata only) |
| GET | `/admin/render-agents` | agent health, queue length |
| GET | `/admin/users/{userId}/usage` | counters, AI cost estimate |
| PATCH | `/admin/users/{userId}/limits` | `{ limitsOverride }` |

---

## 14. Webhooks and internal endpoints

| Endpoint | Caller | Verification | Behaviour |
|---|---|---|---|
| `GET/POST/PUT /api/inngest` | Inngest | signing key | Serves the functions (System Design §11). Not part of `/api/v1`. |
| `POST /api/webhooks/instagram/deauthorize` | Meta | `signed_request` (HMAC-SHA256, app secret) | Mark the account `disconnected`, cancel scheduled posts, notify the user. `200` always after verification. |
| `POST /api/webhooks/instagram/data-deletion` | Meta | `signed_request` | Delete Instagram data for that IG user. Responds `{ url, confirmation_code }` with a status page URL (Meta requirement). |
| `GET /api/health` | uptime monitor | public | `200 { ok: true, version }` — no dependency checks |
| `GET /api/health/deep` | admin | admin session | Checks MongoDB, R2, Gemini, ElevenLabs reachability and the agent heartbeat |

---

## 15. Event catalogue (Inngest)

Internal contracts between the API and background functions. Event `id` = the run's `idempotencyKey`, so Inngest de-duplicates. All payloads carry `userId` and `projectId`.

| Event | Sent by | Payload | Consumed by |
|---|---|---|---|
| `storyboard/requested` | `POST …/storyboard/generate` | `{ runId, regenerate }` | `storyboard.generate` |
| `revision/requested` | `POST …/revisions` | `{ runId, messageId, scopeSceneId }` | `revision.apply` |
| `build/requested` | `POST …/builds`, revision applied | `{ runId, storyboardVersion, changedSceneIds }` | `build.run` |
| `render/requested` | `POST …/renders` | `{ runId, renderId, timelineId }` | `render.run` |
| `render/completed` | render agent | `{ renderId, outputReport }` | `render.run` (waitForEvent) |
| `render/failed` | render agent | `{ renderId, error }` | `render.run` |
| `publish/requested` | `POST …/publish-jobs` (now), scheduler | `{ runId, publishJobId }` | `publish.run` |
| `publish/scheduled` | `POST …/publish-jobs` (scheduled), `PATCH` | `{ publishJobId, scheduledAt }` | `publish.schedule` |
| `run/cancelled` | `POST /runs/{id}/cancel`, project delete | `{ runId }` | `cancelOn` in every function |
| `publish/cancelled` | `DELETE /publish-jobs/{id}`, disconnect, project delete | `{ publishJobId }` | `cancelOn` in `publish.schedule` |
| `account/deletion-requested` | Better Auth `beforeDelete` | `{ userId }` | `account.delete` (DB Design §6.12) |

---

## 16. Endpoint → state transition matrix

How each call moves the project through the state machine in DB Design §5.1.

| Endpoint | From | To (immediately) | To (when the run ends) |
|---|---|---|---|
| `POST …/storyboard/generate` | `idea_draft`, `storyboard_ready` | `storyboard_generating` | `storyboard_ready` · failure: back to the previous status |
| `POST …/revisions` | `storyboard_ready` | (unchanged; revision run active) | `storyboard_ready` |
| `POST …/revisions` | `preview_ready`, `exported` | (unchanged) | `building` → `preview_ready` (incremental build) |
| `POST …/builds` | `storyboard_ready` (+ voice change on `preview_ready`/`exported`) | `building` | `preview_ready` · failure: `needs_attention` |
| `POST …/renders` | `preview_ready`, `exported`, `needs_attention` | `rendering` | `exported` · failure: `needs_attention` |
| `POST /runs/{id}/cancel` | `storyboard_generating`, `building`, `rendering` | previous stable status | — |
| `POST /runs/{id}/retry` | `needs_attention` | `building` / `rendering` | as above |
| `POST …/publish-jobs` (now) | `exported`, `publish_failed` | `publishing` | `posted` · failure: `publish_failed` |
| `POST …/publish-jobs` (scheduled) | `exported`, `publish_failed` | `scheduled` | at the scheduled time: `publishing` → … |
| `DELETE /publish-jobs/{id}` | `scheduled`, `publish_failed` | `exported` | — |
| `DELETE /projects/{id}` | any except `publishing` | (status kept; `deletedAt` set) | — |

---

## 17. Security checklist

- [ ] Every `/api/v1` handler starts with `requireVerifiedUser()` and passes `userId` to the repository layer.
- [ ] Foreign ids → `404`, never `403`.
- [ ] Origin check on unsafe methods; `SameSite=Lax` cookies.
- [ ] Strict Zod validation with unknown keys rejected; body size limits.
- [ ] Redirect targets (`callbackURL`, `returnTo`) accept same-site relative paths only.
- [ ] OAuth `state` is signed, single-use, bound to the session and expires in 10 min.
- [ ] Instagram tokens, voice ids and R2 keys are never returned; media only via short-lived signed URLs.
- [ ] Pasted notes and chat are treated as data in prompts (prompt-injection hygiene, PRD §21.4).
- [ ] Rate limits at the edge; daily usage limits in the database.
- [ ] No stack traces or provider errors in responses; `requestId` for support.
- [ ] Webhooks verify signatures before any side effect.
- [ ] Cross-user access tests for every endpoint in CI (System Design §19).

---

## 18. Versioning and deprecation

- **Path versioning:** `/api/v1`.
- **Allowed without a new version:** adding fields, endpoints, enum values the client can ignore, or optional parameters.
- **Needs `/api/v2`:** removing or renaming fields, changing types or meanings, or making optional parameters required.
- **Deprecations** are announced with `Deprecation` and `Sunset` response headers at least 90 days ahead. With a single first-party client in V1, this mainly matters once a mobile app exists.
- **Clients must ignore unknown fields and unknown enum values** (showing a generic state), so additive changes are safe.

---

## 19. Open questions

| # | Question | Default if not answered |
|---|---|---|
| P1 | **REST for everything** (as designed here) vs. Next.js **server actions** for the web UI's mutations (as in the M1 draft)? REST gives one documented, testable contract and is ready for a mobile app; server actions are less code for the web only. | REST `/api/v1` for all mutations; server components read through the shared service layer |
| P2 | Streaming responses (typing effect) for idea suggestions and idea chat in V1, or plain JSON first? | Plain JSON in V1; streaming as P1 |
| P3 | Should admins (M7) be able to see users' scripts and videos for support, or only metadata? (Same as DB Design D5.) | Metadata only |
| P4 | Hindi error messages in V1 (the app UI is English in V1)? | English only in V1 |
