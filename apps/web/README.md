# Videozilla web app (M1 foundation)

Next.js 16 (App Router, Cache Components) · Better Auth · MongoDB · Inngest · Cloudflare R2.

## Run locally

From the **repository root**:

```bash
npm install                                  # one install for the whole monorepo
cp apps/web/.env.example apps/web/.env.local # then set BETTER_AUTH_SECRET (command in the file)
npm run db                                   # terminal 1: local MongoDB (replica set, data in apps/web/.cache/mongo)
npm run dev                                  # terminal 2: http://localhost:3000
```

Optional, from `apps/web`: `npm run jobs` (Inngest dev server), `npm run email:test -- you@example.com`.

Without `RESEND_API_KEY`, verification and password-reset emails are printed in the `npm run dev` terminal, so you can click the link from there. The Google button appears once `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set.

## What's in M1

| Area | Where |
|---|---|
| Sign up / sign in (email + password with verification, Google), password reset, account linking, delete account | `src/server/auth.ts`, `src/components/auth-forms.tsx`, `src/app/(auth)/*` |
| Route protection (fast cookie check) | `src/proxy.ts` |
| Data access layer: every page and action re-checks the session | `src/server/dal.ts`, `src/app/(app)/actions.ts` |
| User-scoped repositories (every query filtered by `userId`) | `src/server/repos/*` |
| Library: create, rename, duplicate, delete with 10 s undo, filters, search, pagination, "needs attention" | `src/app/(app)/library`, `src/components/library.tsx` |
| Project page with Idea → Storyboard → Video stepper (Idea Studio arrives in M2) | `src/app/(app)/projects/[id]` |
| Settings: defaults (language, length, voice, time zone, notifications) | `src/app/(app)/settings`, `src/components/settings.tsx` |
| Background jobs: daily purge of deleted projects (and their R2 files) | `src/server/jobs/*`, `src/app/api/inngest/route.ts` |
| R2 storage helpers (signed URLs, prefix delete) | `src/server/storage/r2.ts` |

Voice choice is limited to the two approved ElevenLabs voices (female / male); no other voice is offered.

## Notes for this Next.js version

- `middleware.ts` is now `src/proxy.ts`.
- With Cache Components, anything that reads the session, `params`, `searchParams` or the URL renders inside `<Suspense>`. Page shells stay static and instant, and user data streams in.
- Read `node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).
