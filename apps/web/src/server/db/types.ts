import type { ObjectId } from "mongodb";

/** Project lifecycle (PRD §11). */
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
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Library filter groups (PRD F1-FR7). */
export const STATUS_GROUPS = {
  drafts: ["idea_draft", "storyboard_generating", "storyboard_ready", "building", "preview_ready", "rendering"],
  ready: ["exported"],
  scheduled: ["scheduled", "publishing"],
  posted: ["posted"],
  attention: ["needs_attention", "publish_failed"],
} as const satisfies Record<string, readonly ProjectStatus[]>;
export type StatusGroup = keyof typeof STATUS_GROUPS;

export type Language = "en" | "hi";
export type VoiceGender = "female" | "male";

export interface ProjectDoc {
  _id: ObjectId;
  userId: string;
  title: string;
  language: Language;
  lengthPreset: 60 | 90;
  audience: string;
  styleId: string;
  /** Only the two approved voices exist; this picks which one. */
  voiceGender: VoiceGender;
  status: ProjectStatus;
  currentStoryboardVersion: number | null;
  failedStep: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Soft-deleted projects are purged (with their files) after this date. */
  purgeAt: Date | null;
  /** Optimistic-concurrency counter: updates must match it (PRD F1 edge case: two tabs). */
  rev: number;
}

export interface ProfileDoc {
  _id: ObjectId;
  userId: string;
  displayName: string;
  defaultLanguage: Language;
  defaultLengthPreset: 60 | 90;
  defaultVoiceGender: VoiceGender;
  defaultStyleId: string;
  timezone: string;
  emailNotifications: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Public, serialisable shape handed to client components. */
export interface ProjectSummary {
  id: string;
  title: string;
  language: Language;
  lengthPreset: 60 | 90;
  status: ProjectStatus;
  updatedAt: string;
  createdAt: string;
  deleted: boolean;
}
