import { serve } from "inngest/next";
import { functions } from "@/server/jobs/functions";
import { inngest } from "@/server/jobs/inngest";

/**
 * Every job step runs inside one call to this route (Inngest calls it once per step). The storyboard steps make AI
 * calls of up to 75 s (writing) and 45 s (the length fix) plus their database work, so the platform's default limit
 * could cut a step off and fail every run after its retries. 300 s: the longest a Vercel function may run on any plan.
 */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
