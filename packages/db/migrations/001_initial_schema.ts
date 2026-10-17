import type { Document, IndexDescription } from "mongodb";
import { dropIndexIfExists, ensureCollection, type Migration } from "../src/migrate";

/**
 * 001 — every app collection, the database validators (DB Design §9) and the full index catalogue (§8).
 *
 * Frozen: once applied, never edit this file. Enum lists are copied here on purpose (not imported from src/enums.ts)
 * so that later changes to the app can't silently change what this migration did; a test checks they still match.
 */

const userId = { bsonType: "string", pattern: "^[0-9a-f]{24}$" };
const date = { bsonType: "date" };
const dateOrNull = { bsonType: ["date", "null"] };
const objectId = { bsonType: "objectId" };
const int = (minimum?: number, maximum?: number) => ({ bsonType: "int", ...(minimum !== undefined && { minimum }), ...(maximum !== undefined && { maximum }) });
const str = (maxLength?: number, minLength?: number) => ({ bsonType: "string", ...(maxLength !== undefined && { maxLength }), ...(minLength !== undefined && { minLength }) });

const LANGUAGES = ["en", "hi"];
const AUDIENCES = ["kids", "students", "college", "general"];
const BOARDS_OR_EXAMS = ["cbse", "icse", "state", "jee", "neet", "upsc", null];
const PROJECT_STATUSES = [
  "idea_draft", "storyboard_generating", "storyboard_ready", "building", "preview_ready", "rendering",
  "exported", "scheduled", "publishing", "posted", "publish_failed", "needs_attention",
];
const LEASED = ["claimed", "rendering", "uploading"];
const UNLEASED = ["queued", "done", "failed", "cancelled"];

/** `{ $jsonSchema }` plus optional cross-field rules (all must hold). */
const schema = (required: string[], properties: Document, ...rules: Document[]): Document => {
  const jsonSchema = { $jsonSchema: { bsonType: "object", required, properties } };
  return rules.length ? { $and: [jsonSchema, ...rules] } : jsonSchema;
};

const VALIDATORS: Record<string, Document | undefined> = {
  // §4.2
  profiles: schema(
    ["userId", "displayName", "defaultLanguage", "defaultLengthPreset", "defaultVoiceGender", "defaultStyleId", "defaultAudience", "timezone", "emailNotifications", "role", "createdAt", "updatedAt"],
    {
      userId,
      displayName: str(60),
      defaultLanguage: { enum: LANGUAGES },
      defaultLengthPreset: { enum: [60, 90] },
      defaultVoiceGender: { enum: ["female", "male"] },
      defaultStyleId: str(40, 1),
      defaultAudience: { enum: AUDIENCES },
      defaultBoardOrExam: { enum: BOARDS_OR_EXAMS },
      timezone: str(64, 1),
      emailNotifications: { bsonType: "bool" },
      onboardingCompletedAt: dateOrNull,
      role: { enum: ["user", "admin"] },
      limitsOverride: { bsonType: ["object", "null"] },
      createdAt: date,
      updatedAt: date,
    },
  ),
  // §4.3, §9 example
  projects: schema(
    ["userId", "title", "language", "lengthPreset", "voiceGender", "status", "rev", "createdAt", "updatedAt"],
    {
      userId,
      title: str(80, 1),
      language: { enum: LANGUAGES },
      lengthPreset: { enum: [60, 90] },
      audience: { enum: AUDIENCES },
      boardOrExam: { enum: BOARDS_OR_EXAMS },
      voiceGender: { enum: ["female", "male"] },
      captionsEnabled: { bsonType: "bool" },
      status: { enum: PROJECT_STATUSES },
      statusChangedAt: date,
      currentStoryboardVersion: { bsonType: ["int", "null"], minimum: 1 },
      exportOutdated: { bsonType: "bool" },
      revisionCount: int(0),
      rev: int(0),
      deletedAt: dateOrNull,
      purgeAt: dateOrNull,
      createdAt: date,
      updatedAt: date,
    },
    // deletedAt and purgeAt are both null (or missing) or both set.
    { $expr: { $eq: [{ $eq: [{ $ifNull: ["$deletedAt", null] }, null] }, { $eq: [{ $ifNull: ["$purgeAt", null] }, null] }] } },
  ),
  // §4.4
  idea_sessions: schema(["projectId", "userId", "schemaVersion", "mode", "rev", "createdAt", "updatedAt"], {
    projectId: objectId,
    userId,
    schemaVersion: int(1),
    mode: { enum: ["topic", "idea", "notes"] },
    topicInput: str(200),
    ideaInput: str(500),
    notesText: str(20_000),
    rev: int(0),
  }),
  // §4.5
  chat_messages: schema(["projectId", "userId", "thread", "role", "content", "status", "createdAt"], {
    projectId: objectId,
    userId,
    thread: { enum: ["idea", "revision"] },
    role: { enum: ["user", "assistant"] },
    content: str(4_000, 1),
  }),
  // §4.6
  storyboard_versions: schema(
    ["projectId", "userId", "version", "schemaVersion", "data", "source", "changeSummary", "changedSceneIds", "validationReport", "createdAt"],
    {
      projectId: objectId,
      userId,
      version: int(1),
      schemaVersion: int(1),
      data: { bsonType: "object" },
      source: { enum: ["generate", "revision", "manual_edit", "restore", "duplicate"] },
      basedOnVersion: { bsonType: ["int", "null"], minimum: 1 },
      changeSummary: str(300),
      changedSceneIds: { bsonType: "array", items: { bsonType: "string" } },
      validationReport: { bsonType: "object" },
      createdAt: date,
    },
  ),
  // §4.7
  voice_tracks: schema(["projectId", "userId", "sceneId", "textHash", "voiceId", "language", "speed", "audioKey", "durationMs", "words", "timingSource", "createdAt"], {
    projectId: objectId,
    userId,
    language: { enum: LANGUAGES },
    speed: { bsonType: "number", minimum: 0.85, maximum: 1.18 },
    durationMs: { bsonType: "number", minimum: 0, exclusiveMinimum: true },
    words: { bsonType: "array", maxItems: 200 },
    timingSource: { enum: ["tts", "forced_alignment", "estimated"] },
  }),
  // §4.8 — exactly one of data / dataKey.
  timelines: schema(
    ["projectId", "userId", "storyboardVersion", "styleId", "schemaVersion", "hash", "durationMs", "voiceTrackIds", "speed", "syncReport", "createdAt"],
    { projectId: objectId, userId, schemaVersion: int(1), voiceTrackIds: { bsonType: "array", items: objectId } },
    { $or: [{ data: { $type: "object" }, dataKey: { $exists: false } }, { dataKey: { $type: "string" }, data: { $exists: false } }] },
  ),
  // §4.9
  renders: schema(["projectId", "userId", "timelineId", "status", "progress", "isLatest", "createdAt", "updatedAt"], {
    projectId: objectId,
    userId,
    timelineId: objectId,
    status: { enum: ["queued", "rendering", "uploading", "exported", "failed", "cancelled"] },
    progress: int(0, 100),
    isLatest: { bsonType: "bool" },
    purgeAt: dateOrNull,
  }),
  // §4.10 — a lease (agent + expiry) exactly while claimed / rendering / uploading.
  render_jobs: schema(
    ["renderId", "projectId", "userId", "timelineKey", "status", "priority", "attempt", "progress", "createdAt", "updatedAt"],
    {
      renderId: objectId,
      projectId: objectId,
      userId,
      timelineKey: str(undefined, 1),
      status: { enum: [...LEASED, ...UNLEASED] },
      priority: int(0),
      attempt: int(0, 3),
      progress: int(0, 100),
    },
    {
      $or: [
        { status: { $in: LEASED }, leaseExpiresAt: { $type: "date" }, agentId: { $type: "string" } },
        { status: { $in: UNLEASED } },
      ],
    },
  ),
  render_agents: undefined,
  // §4.12 — `connected` mirrors the status; a token is kept unless disconnected.
  instagram_accounts: schema(
    ["userId", "igUserId", "username", "accountType", "tokenExpiresAt", "tokenRefreshedAt", "scopes", "status", "connected", "createdAt", "updatedAt"],
    {
      userId,
      igUserId: str(undefined, 1),
      accountType: { enum: ["BUSINESS", "MEDIA_CREATOR"] },
      scopes: { bsonType: "array", items: { bsonType: "string" } },
      status: { enum: ["active", "needs_reconnect", "disconnected"] },
      connected: { bsonType: "bool" },
    },
    {
      $or: [
        { status: { $in: ["active", "needs_reconnect"] }, connected: true, accessTokenEnc: { $type: "object" } },
        { status: "disconnected", connected: false },
      ],
    },
  ),
  // §4.13 — scheduledAt iff scheduled mode; active iff scheduled / publishing.
  publish_jobs: schema(
    ["projectId", "userId", "renderId", "igAccountId", "caption", "shareToFeed", "mode", "waitForNewExport", "status", "attempts", "idempotencyKey", "active", "rev", "createdAt", "updatedAt"],
    {
      projectId: objectId,
      userId,
      renderId: objectId,
      igAccountId: objectId,
      caption: str(2_200),
      shareToFeed: { bsonType: "bool" },
      mode: { enum: ["now", "scheduled"] },
      waitForNewExport: { bsonType: "bool" },
      status: { enum: ["scheduled", "publishing", "published", "failed", "cancelled"] },
      attempts: int(0, 5),
      idempotencyKey: str(200, 1),
      active: { bsonType: "bool" },
      rev: int(0),
    },
    { $or: [{ mode: "now" }, { mode: "scheduled", scheduledAt: { $type: "date" } }] },
    { $or: [{ status: { $in: ["scheduled", "publishing"] }, active: true }, { status: { $in: ["published", "failed", "cancelled"] }, active: false }] },
  ),
  // §4.14 — active iff queued / running.
  pipeline_runs: schema(
    ["projectId", "userId", "kind", "status", "active", "trigger", "idempotencyKey", "steps", "createdAt", "updatedAt"],
    {
      projectId: objectId,
      userId,
      kind: { enum: ["storyboard", "revision", "build", "render", "publish"] },
      status: { enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
      active: { bsonType: "bool" },
      trigger: { bsonType: "object" },
      idempotencyKey: str(200, 1),
      steps: { bsonType: "array", maxItems: 20 },
    },
    { $or: [{ status: { $in: ["queued", "running"] }, active: true }, { status: { $in: ["succeeded", "failed", "cancelled"] }, active: false }] },
  ),
  notifications: undefined,
  ai_calls: undefined,
  usage_counters: undefined,
  voice_stats: undefined,
  config: undefined,
};

const DAY = 24 * 60 * 60;
const isDate = { $type: "date" };

/** DB Design §8, one entry per row of the index catalogue. */
const INDEXES: Record<string, IndexDescription[]> = {
  profiles: [{ name: "user", key: { userId: 1 }, unique: true }],
  projects: [
    { name: "library", key: { userId: 1, deletedAt: 1, updatedAt: -1, _id: -1 } },
    { name: "library_status", key: { userId: 1, deletedAt: 1, status: 1, updatedAt: -1 } },
    { name: "purge", key: { purgeAt: 1 }, partialFilterExpression: { purgeAt: isDate } },
  ],
  idea_sessions: [{ name: "project", key: { projectId: 1 }, unique: true }],
  chat_messages: [
    { name: "history", key: { projectId: 1, thread: 1, createdAt: 1, _id: 1 } },
    { name: "client_message", key: { projectId: 1, clientMessageId: 1 }, unique: true, partialFilterExpression: { clientMessageId: { $exists: true } } },
  ],
  storyboard_versions: [{ name: "project_version", key: { projectId: 1, version: -1 }, unique: true }],
  voice_tracks: [{ name: "cache", key: { projectId: 1, sceneId: 1, textHash: 1, voiceId: 1, speed: 1 }, unique: true }],
  timelines: [{ name: "project_hash", key: { projectId: 1, hash: 1 }, unique: true }],
  renders: [
    { name: "history", key: { projectId: 1, createdAt: -1 } },
    { name: "latest", key: { projectId: 1 }, unique: true, partialFilterExpression: { isLatest: true } },
    { name: "purge", key: { purgeAt: 1 }, partialFilterExpression: { purgeAt: isDate } },
  ],
  render_jobs: [
    { name: "claim", key: { status: 1, priority: 1, queuedAt: 1 } },
    { name: "lease", key: { status: 1, leaseExpiresAt: 1 } },
    { name: "render", key: { renderId: 1 }, unique: true },
  ],
  render_agents: [{ name: "agent", key: { agentId: 1 }, unique: true }],
  instagram_accounts: [
    { name: "connected_user", key: { userId: 1 }, unique: true, partialFilterExpression: { connected: true } },
    { name: "connected_ig_user", key: { igUserId: 1 }, unique: true, partialFilterExpression: { connected: true } },
    { name: "token_refresh", key: { status: 1, tokenExpiresAt: 1 } },
  ],
  publish_jobs: [
    { name: "idempotency", key: { idempotencyKey: 1 }, unique: true },
    { name: "active_per_project", key: { projectId: 1 }, unique: true, partialFilterExpression: { active: true } },
    { name: "schedule", key: { status: 1, scheduledAt: 1 } },
    { name: "account_status", key: { igAccountId: 1, status: 1 } },
  ],
  pipeline_runs: [
    { name: "active_per_kind", key: { projectId: 1, kind: 1 }, unique: true, partialFilterExpression: { active: true } },
    { name: "project_recent", key: { projectId: 1, createdAt: -1 } },
    { name: "idempotency", key: { idempotencyKey: 1 }, unique: true },
    { name: "watchdog", key: { active: 1, updatedAt: 1 }, partialFilterExpression: { active: true } },
  ],
  notifications: [
    { name: "inbox", key: { userId: 1, readAt: 1, createdAt: -1 } },
    { name: "ttl_90d", key: { createdAt: 1 }, expireAfterSeconds: 90 * DAY },
  ],
  ai_calls: [
    { name: "user_recent", key: { userId: 1, createdAt: -1 } },
    { name: "ttl_180d", key: { createdAt: 1 }, expireAfterSeconds: 180 * DAY },
  ],
  usage_counters: [
    { name: "user_day", key: { userId: 1, date: 1 }, unique: true },
    { name: "ttl", key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  voice_stats: [{ name: "key", key: { key: 1 }, unique: true }],
  config: [{ name: "key", key: { key: 1 }, unique: true }],
};

export default {
  async up({ db, log }) {
    for (const [name, validator] of Object.entries(VALIDATORS)) {
      await ensureCollection(db, name, validator);
    }
    log(`${Object.keys(VALIDATORS).length} collections ready (${Object.values(VALIDATORS).filter(Boolean).length} with validators)`);

    // The M1 draft created a 3-key "library" index at start-up; the catalogue's "library" index adds _id for paging.
    const legacy = (await db.collection("projects").indexes()).find((i) => i.name === "library" && !("_id" in i.key));
    if (legacy && (await dropIndexIfExists(db, "projects", "library"))) log("replaced the draft projects.library index");

    let count = 0;
    for (const [collection, indexes] of Object.entries(INDEXES)) {
      await db.collection(collection).createIndexes(indexes);
      count += indexes.length;
    }
    log(`${count} indexes ready`);
  },
} satisfies Migration;
