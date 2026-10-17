import type { Audience, BOARDS_OR_EXAMS, Language, ProfileRole, ProjectStatus, VoiceGender } from "@videozilla/db";
import type { ObjectId } from "mongodb";

/** Project lifecycle (DB Design §5.1); the stored enums live in packages/db. */
export { PROJECT_STATUSES } from "@videozilla/db";
export type { Audience, Language, ProfileRole, ProjectStatus, VoiceGender };
export type BoardOrExam = (typeof BOARDS_OR_EXAMS)[number];

/** Library filter groups (PRD F1-FR7). */
export const STATUS_GROUPS = {
  drafts: ["idea_draft", "storyboard_generating", "storyboard_ready", "building", "preview_ready", "rendering"],
  ready: ["exported"],
  scheduled: ["scheduled", "publishing"],
  posted: ["posted"],
  attention: ["needs_attention", "publish_failed"],
} as const satisfies Record<string, readonly ProjectStatus[]>;
export type StatusGroup = keyof typeof STATUS_GROUPS;

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
  /** DB Design §4.3; written by later features (export, publishing), so older drafts may not have them yet. */
  exportOutdated?: boolean;
  postedAt?: Date | null;
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
  defaultAudience: Audience;
  defaultBoardOrExam?: BoardOrExam | null;
  timezone: string;
  emailNotifications: boolean;
  onboardingCompletedAt?: Date | null;
  role: ProfileRole;
  createdAt: Date;
  updatedAt: Date;
}

/** Public, serialisable shape handed to client components. */
/** A library list item: the `ProjectSummary` resource of API Design §12. */
export interface ProjectSummary {
  id: string;
  title: string;
  language: Language;
  lengthPreset: 60 | 90;
  status: ProjectStatus;
  /** Signed cover image URL once a video is exported (renders arrive in M4). */
  coverUrl: string | null;
  exportOutdated: boolean;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/** `GET /api/v1/projects?filter=` values (API Design §13.2). */
export const PROJECT_FILTERS = ["all", "drafts", "ready", "scheduled", "posted", "attention"] as const;
export type ProjectFilter = (typeof PROJECT_FILTERS)[number];
