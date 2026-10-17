import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MongoServerError, type Collection, type Db, type Document } from "mongodb";
import { COLLECTIONS } from "./collections";

/**
 * Migration runner (DB Design §12). Migrations are numbered files in `packages/db/migrations/NNN_description.ts`
 * whose default export is `{ up(ctx) }`. Each applied migration is recorded in the `migrations` collection with a
 * checksum of its file; editing a migration after it was applied fails the run, so schema changes always go in a
 * new file. Migrations must be safe to re-run (create-if-missing, upserts), because a failed run is retried as a whole.
 */

export interface MigrationContext {
  db: Db;
  log: (message: string) => void;
}

export interface Migration {
  up(ctx: MigrationContext): Promise<void>;
}

interface MigrationRecord {
  name: string;
  appliedAt?: Date;
  checksum?: string;
  /** Lock document only. */
  lockedAt?: Date;
  holder?: string;
}

export interface MigrationFile {
  name: string;
  file: string;
  checksum: string;
}

export interface MigrateOptions {
  dir?: string;
  log?: (message: string) => void;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const LOCK = "__lock__";
/** A lock older than this is assumed to belong to a crashed run and is taken over. */
const STALE_LOCK_MS = 15 * 60_000;
const FILE_NAME = /^(\d{3}_[a-z0-9_]+)\.ts$/;

/** The migration files in `dir`, in order, with checksums of their contents (line endings normalised). */
export async function listMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => FILE_NAME.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const source = (await readFile(path.join(dir, file), "utf8")).replace(/\r\n/g, "\n");
      return { name: file.match(FILE_NAME)![1], file: path.join(dir, file), checksum: createHash("sha256").update(source).digest("hex") };
    }),
  );
}

function records(db: Db): Collection<MigrationRecord> {
  return db.collection<MigrationRecord>(COLLECTIONS.migrations);
}

/** Which migrations are applied, pending, or changed since they were applied. */
export async function migrationStatus(db: Db, opts: MigrateOptions = {}) {
  const files = await listMigrations(opts.dir);
  const applied = new Map((await records(db).find({ name: { $ne: LOCK } }).toArray()).map((r) => [r.name, r]));
  return files.map((f) => {
    const record = applied.get(f.name);
    const state = !record ? "pending" : record.checksum === f.checksum ? "applied" : "changed";
    return { name: f.name, state, appliedAt: record?.appliedAt ?? null } as const;
  });
}

async function acquireLock(db: Db): Promise<void> {
  const now = new Date();
  try {
    await records(db).insertOne({ name: LOCK, lockedAt: now, holder: `${hostname()}:${process.pid}` });
  } catch (err) {
    if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
    const takenOver = await records(db).findOneAndUpdate(
      { name: LOCK, lockedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      { $set: { lockedAt: now, holder: `${hostname()}:${process.pid}` } },
    );
    if (!takenOver) throw new Error("Another migration run is in progress (the migrations lock is held). Try again in a minute.");
  }
}

/** Applies every pending migration in order. Returns the names applied by this run and those already applied. */
export async function runMigrations(db: Db, opts: MigrateOptions = {}): Promise<{ applied: string[]; alreadyApplied: string[] }> {
  const log = opts.log ?? ((m: string) => console.log(m));
  await records(db).createIndex({ name: 1 }, { unique: true, name: "name" });
  await acquireLock(db);
  try {
    const files = await listMigrations(opts.dir);
    const done = new Map((await records(db).find({ name: { $ne: LOCK } }).toArray()).map((r) => [r.name, r]));

    for (const name of done.keys()) {
      if (!files.some((f) => f.name === name)) log(`warning: migration ${name} was applied but its file is missing`);
    }
    const changed = files.filter((f) => done.has(f.name) && done.get(f.name)!.checksum !== f.checksum);
    if (changed.length) {
      throw new Error(
        `Migration ${changed.map((f) => f.name).join(", ")} was changed after it was applied. ` +
          "Undo the edit and put the change in a new migration file instead.",
      );
    }

    const applied: string[] = [];
    for (const f of files.filter((f) => !done.has(f.name))) {
      const mod = (await import(pathToFileURL(f.file).href)) as { default?: Migration };
      if (typeof mod.default?.up !== "function") throw new Error(`Migration ${f.name} must default-export { up(ctx) }.`);
      log(`applying ${f.name}…`);
      try {
        await mod.default.up({ db, log: (m) => log(`  ${m}`) });
      } catch (err) {
        throw new Error(`Migration ${f.name} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
      await records(db).insertOne({ name: f.name, appliedAt: new Date(), checksum: f.checksum });
      applied.push(f.name);
    }
    return { applied, alreadyApplied: files.filter((f) => done.has(f.name)).map((f) => f.name) };
  } finally {
    await records(db).deleteOne({ name: LOCK });
  }
}

// ---------- Helpers for migration files ----------

/** Creates the collection if it doesn't exist; when a validator is given, sets it (DB Design §9: moderate, error). */
export async function ensureCollection(db: Db, name: string, validator?: Document): Promise<void> {
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  const options = validator ? { validator, validationLevel: "moderate" as const, validationAction: "error" as const } : {};
  if (!exists) await db.createCollection(name, options);
  else if (validator) await db.command({ collMod: name, ...options });
}

/** Drops an index if it exists (no error when the index or the collection is missing). */
export async function dropIndexIfExists(db: Db, collection: string, index: string): Promise<boolean> {
  try {
    await db.collection(collection).dropIndex(index);
    return true;
  } catch (err) {
    // 26 NamespaceNotFound, 27 IndexNotFound
    if (err instanceof MongoServerError && (err.code === 26 || err.code === 27)) return false;
    throw err;
  }
}
