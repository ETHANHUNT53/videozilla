import type { ProfileDoc, ProjectDoc } from "../db/types";
import { toSummary } from "../repos/projects";
import { allowedActions } from "../rules/project-actions";
import type { SessionUser } from "./session";

/** The `Project` resource (API Design §12): the list fields plus settings, progress and what the user may do next. */
export function toProject(p: ProjectDoc) {
  return {
    ...toSummary(p),
    audience: p.audience,
    boardOrExam: p.boardOrExam ?? null,
    styleId: p.styleId,
    voiceGender: p.voiceGender,
    captionsEnabled: p.captionsEnabled ?? false,
    attention: p.attention ? { ...p.attention, at: p.attention.at.toISOString() } : null,
    currentStoryboardVersion: p.currentStoryboardVersion,
    latestRender: null, // renders arrive in M4
    activePublishJob: null, // publishing arrives in M6
    permalink: p.permalink ?? null,
    revisionCount: p.revisionCount ?? 0,
    allowedActions: allowedActions(p.status),
  };
}

/** The `Project` resource's shape; client components import it as a type only. */
export type ProjectResource = ReturnType<typeof toProject>;

/**
 * Database documents → API resource shapes (API Design §12). Optional fields with no value are `null`, never
 * omitted, so shapes stay stable; dates are ISO 8601 strings; internal fields (`_id`, `role`, …) are not exposed.
 */

export function toProfile(p: ProfileDoc) {
  return {
    displayName: p.displayName,
    defaultLanguage: p.defaultLanguage,
    defaultLengthPreset: p.defaultLengthPreset,
    defaultVoiceGender: p.defaultVoiceGender,
    defaultStyleId: p.defaultStyleId,
    defaultAudience: p.defaultAudience,
    defaultBoardOrExam: p.defaultBoardOrExam ?? null,
    timezone: p.timezone,
    emailNotifications: p.emailNotifications,
    onboardingCompleted: Boolean(p.onboardingCompletedAt),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toMeUser(u: SessionUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    image: u.image ?? null,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}
