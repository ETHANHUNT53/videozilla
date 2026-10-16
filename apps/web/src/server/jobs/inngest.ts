import { Inngest } from "inngest";

/**
 * Durable background jobs (PRD D12, F10). Locally, run the Inngest dev server (npm run jobs) and it discovers the
 * functions at /api/inngest. In production, INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are read from the environment.
 */
export const inngest = new Inngest({ id: "videozilla" });
