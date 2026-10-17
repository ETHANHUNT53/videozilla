import "server-only";
import { collections } from "./db/mongo";
import { hasAnyProject } from "./repos/projects";

/**
 * Who sees the Welcome screen (F1.12): first-time users only — onboarding not done and no project yet (deleted ones
 * count), so people who were creating before onboarding existed go straight to their Library. Reads only; a user
 * without a profile yet counts as not onboarded.
 */
export async function needsWelcome(userId: string): Promise<boolean> {
  const profile = await collections.profiles().findOne({ userId }, { projection: { onboardingCompletedAt: 1 } });
  if (profile?.onboardingCompletedAt) return false;
  return !(await hasAnyProject(userId));
}
