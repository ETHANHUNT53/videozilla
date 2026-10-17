/**
 * Collection names (DB Design §1, §4). Better Auth's own collections (`user`, `session`, `account`, `verification`)
 * are managed by Better Auth and are not listed here.
 */
export const COLLECTIONS = {
  profiles: "profiles",
  projects: "projects",
  ideaSessions: "idea_sessions",
  chatMessages: "chat_messages",
  storyboardVersions: "storyboard_versions",
  voiceTracks: "voice_tracks",
  timelines: "timelines",
  renders: "renders",
  renderJobs: "render_jobs",
  renderAgents: "render_agents",
  instagramAccounts: "instagram_accounts",
  publishJobs: "publish_jobs",
  pipelineRuns: "pipeline_runs",
  notifications: "notifications",
  aiCalls: "ai_calls",
  usageCounters: "usage_counters",
  voiceStats: "voice_stats",
  config: "config",
  migrations: "migrations",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
