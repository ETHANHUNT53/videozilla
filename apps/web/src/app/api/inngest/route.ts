import { serve } from "inngest/next";
import { functions } from "@/server/jobs/functions";
import { inngest } from "@/server/jobs/inngest";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
