import type { ProfileDoc } from "../db/types";
import type { SessionUser } from "./session";

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
