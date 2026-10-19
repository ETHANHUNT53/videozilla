import type { ChatMessageDoc, IdeaBriefDoc, IdeaSessionDoc, ProfileDoc, ProjectDoc } from "../db/types";
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
    about: p.about ?? null,
    onboardingCompleted: Boolean(p.onboardingCompletedAt),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** The `Profile` resource's shape; client components import it as a type only. */
export type ProfileResource = ReturnType<typeof toProfile>;

/** A brief as the API shows it (API Design §12); `sourceNotesSummary` only on briefs made from notes (F2.4). */
export function toBrief(b: IdeaBriefDoc) {
  return {
    title: b.title,
    hook: b.hook,
    angle: b.angle,
    audience: b.audience,
    keyPoints: b.keyPoints,
    outOfScope: b.outOfScope ?? [],
    ...(b.sourceNotesSummary ? { sourceNotesSummary: b.sourceNotesSummary } : {}),
  };
}

/** The `IdeaSession` resource (API Design §12, §13.3). */
export function toIdeaSession(i: IdeaSessionDoc) {
  return {
    projectId: i.projectId.toHexString(),
    mode: i.mode,
    topicInput: i.topicInput ?? "",
    ideaInput: i.ideaInput ?? "",
    notesText: i.notesText ?? "",
    suggestions: (i.suggestions ?? []).map(({ id, title, hook, angle, keyPoints }) => ({ id, title, hook, angle, keyPoints })),
    brief: i.brief ? toBrief(i.brief) : null,
    briefAlternatives: (i.briefAlternatives ?? []).map(toBrief),
    /** When the brief last changed; "Use this angle" sends it back so a repeated request can't swap twice. */
    briefUpdatedAt: i.briefUpdatedAt ? i.briefUpdatedAt.toISOString() : null,
    /** What the brief was written for (F2.6 follow-up); null for briefs from before it (treated as the video's settings). */
    briefLanguage: i.brief ? (i.briefLanguage ?? null) : null,
    briefLengthSec: i.brief ? (i.briefLengthSec ?? null) : null,
    rev: i.rev,
    updatedAt: i.updatedAt.toISOString(),
  };
}

/** The `IdeaSession` resource's shape; client components import it as a type only. */
export type IdeaSessionResource = ReturnType<typeof toIdeaSession>;

/** A chat message still "processing" after this long belongs to a request that died (a crash, a timeout): it can be sent again. */
export const CHAT_STALE_PROCESSING_MS = 2 * 60_000;

/**
 * The `ChatMessage` resource (API Design §12). The idea chat (F2.5) adds `changedFields` (assistant answers that
 * changed the brief); the revision fields stay empty until F7. A message still being answered shows as `pending`;
 * one left behind by a request that died shows as `failed` once it's stale, so the page offers "Send again" (which takes
 * it over, see claimUserMessage) instead of showing it as pending for ever.
 */
export function toChatMessage(m: ChatMessageDoc, now = Date.now()) {
  return {
    id: m._id.toHexString(),
    thread: m.thread,
    role: m.role,
    content: m.content,
    status: m.status === "processing" ? (m.updatedAt.getTime() < now - CHAT_STALE_PROCESSING_MS ? ("failed" as const) : ("pending" as const)) : m.status,
    clientMessageId: m.clientMessageId ?? null,
    changedFields: m.changedFields ?? [],
    scopeSceneId: null,
    clarification: null,
    changedSceneIds: [] as string[],
    versionBefore: null,
    versionAfter: null,
    canUndo: false,
    createdAt: m.createdAt.toISOString(),
  };
}
export type ChatMessageResource = ReturnType<typeof toChatMessage>;

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
