# @videozilla/db

MongoDB access shared by the web app, background jobs and scripts ([DB Design](../../docs/DB_DESIGN.md)).

| Import | What it gives you |
|---|---|
| `@videozilla/db` | `getMongoClient(uri)` (one pooled client per process), `COLLECTIONS` names, stored enums (`PROJECT_STATUSES`, …). Safe to use in the Next.js app. |
| `@videozilla/db/migrate` | Node-only migration runner (`runMigrations`, `migrationStatus`) and helpers for migration files. |

## Migrations

```bash
npm run db:migrate              # apply pending migrations to MONGODB_URI / MONGODB_DB
npm run db:migrate -- --status  # list applied / pending / changed
```

Locally, `npm run db` applies them every time the database starts (settings come from `apps/web/.env.local`).

| File | What it does |
|---|---|
| `migrations/001_initial_schema.ts` | All 19 app collections, database validators (§9) and the full index catalogue (§8) |
| `migrations/002_profile_defaults.ts` | Backfills `defaultAudience` and `role` on profiles made by the M1 draft |

**Adding a change:** create the next numbered file, e.g. `migrations/003_add_something.ts`:

```ts
import type { Migration } from "../src/migrate";

export default {
  async up({ db, log }) {
    // create-if-missing / upserts only: a failed run is retried as a whole
  },
} satisfies Migration;
```

- Never edit a migration that has been applied: the runner stores each file's checksum and refuses to run if it changed.
- If you change an enum in `src/enums.ts`, add a migration that updates the matching validator; the tests fail until you do.
- Only one run at a time: a lock in the `migrations` collection stops a second run (a lock older than 15 minutes is taken over).

Tests (`npm test`) run every migration against a throwaway in-memory MongoDB.
