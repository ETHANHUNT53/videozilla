/**
 * Stored enum values (DB Design §4, §5). The database validators in `migrations/` hold a frozen copy of these lists;
 * a unit test fails if the two drift apart, so changing a list here means adding a migration that updates the validator.
 */

export const LANGUAGES = ["en", "hi"] as const;
export const LENGTH_PRESETS = [60, 90] as const;
export const VOICE_GENDERS = ["female", "male"] as const;
export const AUDIENCES = ["kids", "students", "college", "general"] as const;
export const BOARDS_OR_EXAMS = ["cbse", "icse", "state", "jee", "neet", "upsc"] as const;
export const PROFILE_ROLES = ["user", "admin"] as const;

/** Project lifecycle (DB Design §5.1). */
export const PROJECT_STATUSES = [
  "idea_draft",
  "storyboard_generating",
  "storyboard_ready",
  "building",
  "preview_ready",
  "rendering",
  "exported",
  "scheduled",
  "publishing",
  "posted",
  "publish_failed",
  "needs_attention",
] as const;

export const STORYBOARD_SOURCES = ["generate", "revision", "manual_edit", "restore", "duplicate"] as const;
export const CHAT_THREADS = ["idea", "revision"] as const;
export const CHAT_ROLES = ["user", "assistant"] as const;

/** §5.4 */
export const RENDER_STATUSES = ["queued", "rendering", "uploading", "exported", "failed", "cancelled"] as const;
/** §5.5 — the first three hold a lease. */
export const RENDER_JOB_STATUSES = ["claimed", "rendering", "uploading", "queued", "done", "failed", "cancelled"] as const;
export const LEASED_RENDER_JOB_STATUSES = ["claimed", "rendering", "uploading"] as const;

/** §5.6 — the first two are "active". */
export const PUBLISH_JOB_STATUSES = ["scheduled", "publishing", "published", "failed", "cancelled"] as const;
export const PUBLISH_MODES = ["now", "scheduled"] as const;

export const PIPELINE_RUN_KINDS = ["storyboard", "revision", "build", "render", "publish"] as const;
/** §5.3 — the first two are "active". */
export const PIPELINE_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

/** §5.8 */
export const IG_ACCOUNT_STATUSES = ["active", "needs_reconnect", "disconnected"] as const;
export const IG_ACCOUNT_TYPES = ["BUSINESS", "MEDIA_CREATOR"] as const;

export const TIMING_SOURCES = ["tts", "forced_alignment", "estimated"] as const;

export type Language = (typeof LANGUAGES)[number];
export type VoiceGender = (typeof VOICE_GENDERS)[number];
export type Audience = (typeof AUDIENCES)[number];
export type ProfileRole = (typeof PROFILE_ROLES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
