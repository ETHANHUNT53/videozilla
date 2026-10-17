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

export interface ProjectAttention {
  kind: "storyboard" | "build" | "render" | "publish";
  step: string;
  errorCode: string;
  message: string;
  at: Date;
}

/**
 * A project (DB Design §4.3). Projects created from F1.7 on have every field; the optional ones may be missing on
 * drafts made by the M1 draft, so readers default them (`?? false`, `?? null`, `?? 0`).
 */
export interface ProjectDoc {
  _id: ObjectId;
  userId: string;
  title: string;
  language: Language;
  lengthPreset: 60 | 90;
  audience: string;
  boardOrExam?: BoardOrExam | null;
  styleId: string;
  /** Only the two approved voices exist; this picks which one. */
  voiceGender: VoiceGender;
  captionsEnabled?: boolean;
  status: ProjectStatus;
  statusChangedAt?: Date;
  /** Set iff status is needs_attention / publish_failed (replaces the draft's `failedStep`). */
  attention?: ProjectAttention | null;
  currentStoryboardVersion: number | null;
  currentTimelineId?: ObjectId | null;
  latestRenderId?: ObjectId | null;
  exportOutdated?: boolean;
  postedAt?: Date | null;
  permalink?: string | null;
  duplicatedFrom?: ObjectId | null;
  revisionCount?: number;
  /** M1 draft only; superseded by `attention`. */
  failedStep?: string | null;
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
  /** "What do you teach or create about?" (onboarding, Settings), ≤ 200 characters; tailors idea suggestions (F2). */
  about?: string | null;
  role: ProfileRole;
  /** Per-user daily limits set by an admin (DB Design §4.2, §4.17), e.g. `{ renders: 20 }`. */
  limitsOverride?: Partial<Record<string, number>> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Public, serialisable shape handed to client components. */
/** One per project, created with it (DB Design §4.4, §6.1). The Idea Studio (F2) fills it in. */
export interface IdeaSessionDoc {
  _id: ObjectId;
  projectId: ObjectId;
  userId: string;
  schemaVersion: 1;
  mode: "topic" | "idea" | "notes";
  topicInput: string;
  ideaInput: string;
  notesText: string;
  suggestions: { id: string; title: string; hook: string; angle: string; keyPoints: string[] }[];
  brief: { title: string; hook: string; angle: string; audience: string; keyPoints: string[]; outOfScope: string[]; sourceNotesSummary?: string } | null;
  briefUpdatedAt: Date | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

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
