import "server-only";
import type { AiProvider } from "@videozilla/ai";
import type { ObjectId } from "mongodb";
import { collections } from "../db/mongo";

/** One AI call (Groq, OpenRouter or Gemini), for cost and reliability tracking (DB Design §4.16; kept 180 days by a TTL index). */
export interface AiCallEntry {
  userId: string;
  projectId?: ObjectId;
  /** The pipeline run the call belongs to (storyboard generation). */
  runId?: ObjectId;
  provider: AiProvider;
  task: "ideas" | "brief" | "idea_chat" | "storyboard" | "revision" | "length_fix" | "accuracy" | "caption";
  model: string;
  status: "ok" | "retry" | "failed" | "fallback";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string;
}

/** Records a call. Never throws: logging must not break the feature. */
export async function logAiCall(entry: AiCallEntry): Promise<void> {
  try {
    await collections.aiCalls().insertOne({ ...entry, createdAt: new Date() });
  } catch (err) {
    console.warn("[ai_calls] couldn't log an AI call:", err instanceof Error ? err.message : err);
  }
}
