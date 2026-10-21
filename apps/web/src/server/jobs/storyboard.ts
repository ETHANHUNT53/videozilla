import "server-only";
import { AiBlockedError, AiBusyError, AiOutputError, fixStoryboardLength, writeStoryboard, type AiCallLog, type StoryboardInput } from "@videozilla/ai";
import { lengthStatus, validateStoryboard } from "@videozilla/pipeline";
import { RawStoryboard, WORD_BUDGET, type Storyboard } from "@videozilla/schema";
import { ObjectId } from "mongodb";
import { after } from "next/server";
import { env } from "../env";
import { logAiCall } from "../repos/ai-calls";
import {
  failRun,
  getRun,
  LENGTH_FIX_LABEL,
  loadRunContext,
  markOutboxSent,
  refundCancelledRun,
  saveStoryboardVersion,
  setStepLabel,
  stepFinished,
  stepStarted,
  type PipelineRunDoc,
  type RunErrorCode,
  type StoryboardStep,
  type StoryboardVersionDoc,
} from "../repos/storyboards";
import { inngest } from "./inngest";

/**
 * The `storyboard.generate` job (F3.1, PRD §16.1 P1): brief → script and scenes (T4) → validation and repair, with one
 * length fix (T7) when the script is more than 15 % off its word budget → saved as the next version (F3.2). Its steps
 * are plain functions, so Inngest (`step.run`, retried and resumable) and the local fallback (no job runner) run the
 * same code. Every step updates the run, which `GET …/status` shows. See docs/features/F3.1-generate-storyboard.md.
 */

/** Runs one named step: Inngest's `step.run` (memoised, retried), or just the function (inline). */
export type StepRunner = <T>(name: StoryboardStep, fn: () => Promise<T>) => Promise<T>;
const inline: StepRunner = (_name, fn) => fn();

type Outcome = "saved" | "failed" | "cancelled";
interface Context {
  input: StoryboardInput;
  projectId: string;
  userId: string;
}
interface Draft {
  raw: unknown;
  model: string;
  provider: string;
}
interface Checked {
  storyboard: Storyboard;
  report: StoryboardVersionDoc["validationReport"];
  model: string;
  provider: string;
}

/** The run's outcome for an AI error, or null for anything else (a bug or a database error: retried, then INTERNAL). */
function aiFailure(err: unknown): { code: RunErrorCode; refund: boolean } | null {
  if (err instanceof AiBlockedError) return { code: "UNSAFE_CONTENT", refund: false };
  if (err instanceof AiBusyError) return { code: err.unavailable ? "AI_UNAVAILABLE" : "AI_BUSY", refund: true };
  if (err instanceof AiOutputError) return { code: "AI_OUTPUT_INVALID", refund: true };
  return null;
}

/** How far a word count is outside the budget (0 inside it). */
function offBudget(words: number, input: StoryboardInput): number {
  const [minW, maxW] = WORD_BUDGET[input.language][input.lengthSec];
  return Math.max(0, minW - words, words - maxW);
}

export async function runStoryboardJob(runId: string, step: StepRunner = inline): Promise<Outcome> {
  const id = new ObjectId(runId);

  const ctx = await step("load_context", async (): Promise<Context | null> => {
    const run = await getRun(runId);
    if (!run?.active || !(await stepStarted(id, "load_context"))) return null;
    const c = await loadRunContext(run);
    if (!c) {
      await failRun(id, "INTERNAL", { step: "load_context", message: "The brief for this video couldn't be found. Try again." });
      return null;
    }
    const b = c.idea.brief!;
    const input: StoryboardInput = {
      brief: { title: b.title, hook: b.hook, angle: b.angle, keyPoints: b.keyPoints, outOfScope: b.outOfScope ?? [], ...(b.sourceNotesSummary ? { sourceNotesSummary: b.sourceNotesSummary } : {}) },
      language: c.project.language,
      lengthSec: c.project.lengthPreset,
      audience: c.project.audience as StoryboardInput["audience"],
      boardOrExam: c.project.boardOrExam ?? null,
      creatorAbout: c.about,
      // A brief made from notes keeps to their facts (F2.4), so the script sees them too.
      notes: b.sourceNotesSummary && c.idea.notesText?.trim() ? c.idea.notesText : null,
    };
    await stepFinished(id, "load_context");
    return { input, projectId: run.projectId.toHexString(), userId: run.userId };
  });
  if (!ctx) return finish(id);

  const log = (task: "storyboard" | "length_fix") => (entry: AiCallLog) =>
    logAiCall({ userId: ctx.userId, projectId: new ObjectId(ctx.projectId), runId: id, task, ...entry });

  const draft = await step("write_script", async (): Promise<Draft | null> => {
    if (!(await stepStarted(id, "write_script"))) return null;
    try {
      const { reply, model, provider } = await writeStoryboard(ctx.input, log("storyboard"));
      if ("refused" in reply) {
        await failRun(id, "UNSAFE_CONTENT", { refund: false, step: "write_script" });
        return null;
      }
      await stepFinished(id, "write_script", `${reply.scenes.length} scenes (${provider})`);
      return { raw: reply, model, provider };
    } catch (err) {
      const failure = aiFailure(err);
      if (!failure) throw err;
      await failRun(id, failure.code, { refund: failure.refund, step: "write_script" });
      return null;
    }
  });
  if (!draft) return finish(id);

  const checked = await step("check", async (): Promise<Checked | null> => {
    if (!(await stepStarted(id, "check"))) return null;
    const { language, lengthSec } = ctx.input;
    let best = validateStoryboard(RawStoryboard.parse(draft.raw), language, lengthSec);
    let model = draft.model;
    let provider = draft.provider;
    let lengthFixed = false;
    if (lengthStatus(best.report.wordCount, language, lengthSec) !== "ok") {
      await setStepLabel(id, "check", LENGTH_FIX_LABEL);
      try {
        const fix = await fixStoryboardLength(ctx.input, best.storyboard, best.report.wordCount, log("length_fix"));
        if (!("refused" in fix.reply)) {
          const second = validateStoryboard(fix.reply, language, lengthSec);
          if (offBudget(second.report.wordCount, ctx.input) < offBudget(best.report.wordCount, ctx.input)) {
            best = second;
            model = fix.model;
            provider = fix.provider;
            lengthFixed = true;
          }
        }
      } catch (err) {
        // The first script is still a storyboard: keep it, with the length warning (the F3.3 duration chip).
        if (!aiFailure(err)) throw err;
        best.report.warnings.push("the automatic length fix didn't come back; kept the first script");
      }
    }
    await stepFinished(id, "check", `${best.report.wordCount} words, ~${best.report.estimatedDurationSec}s${lengthFixed ? ", length fixed" : ""}`);
    return { storyboard: best.storyboard, report: { ...best.report, lengthFixed }, model, provider };
  });
  if (!checked) return finish(id);

  return step("save_version", async (): Promise<Outcome> => {
    if (!(await stepStarted(id, "save_version"))) return finish(id);
    const saved = await saveStoryboardVersion(id, checked.storyboard, checked.report, { model: checked.model, provider: checked.provider });
    return saved === "cancelled" ? finish(id) : "saved";
  });
}

/**
 * The run ended early: failed (already recorded) or cancelled (the video was deleted, which cancels its runs). A
 * cancelled run's unit is given back once, like the idea AI does for a video that moved on.
 */
async function finish(id: ObjectId): Promise<Outcome> {
  const run = await getRun(id.toHexString());
  if (run?.status === "cancelled") {
    await refundCancelledRun(id);
    return "cancelled";
  }
  if (run?.active) {
    // Stopped without a recorded reason (shouldn't happen): don't leave the video generating.
    await failRun(id, "INTERNAL");
  }
  return "failed";
}

/** The Inngest function: one per project at a time; a step that crashed is retried twice, then the run fails. */
export const generateStoryboard = inngest.createFunction(
  {
    id: "storyboard-generate",
    triggers: [{ event: "storyboard/requested" }],
    retries: 2,
    concurrency: { key: "event.data.projectId", limit: 1 },
    onFailure: async ({ event }) => {
      const runId = (event.data as { event?: { data?: { runId?: string } } }).event?.data?.runId;
      if (runId && ObjectId.isValid(runId)) await failRun(new ObjectId(runId), "INTERNAL");
    },
  },
  async ({ event, step }) => {
    const runId = (event.data as { runId: string }).runId;
    const outcome = await runStoryboardJob(runId, (name, fn) => step.run(name, fn) as never);
    return { runId, outcome };
  },
);

/** Runs `fn` after the response is sent (Next's `after`), or right away in the background outside a request. */
function afterResponse(fn: () => Promise<unknown>): void {
  try {
    after(fn);
  } catch {
    void fn();
  }
}

/**
 * Hands a new run to the job runner (DB Design §7.6: the event is sent after the commit; the event id makes a re-send a
 * no-op). Without a reachable job runner, local development runs the job in this server process after the response
 * (like account deletion does); production fails the run at once (unit given back, video moved back), so nothing hangs.
 */
export async function dispatchStoryboardRun(run: PipelineRunDoc, opts: { schedule?: (fn: () => Promise<unknown>) => void } = {}): Promise<"queued" | "inline" | "failed"> {
  const runId = run._id.toHexString();
  let sent = false;
  try {
    await inngest.send({ id: run.idempotencyKey, name: "storyboard/requested", data: { runId, projectId: run.projectId.toHexString() } });
    sent = true;
  } catch (err) {
    console.warn(`[storyboard] couldn't queue run ${runId}:`, err instanceof Error ? err.message : err);
  }
  if (sent) {
    // The job is queued: recording that is bookkeeping only. A failure here mustn't be taken for "no job runner" (which
    // fails the run in production while the job would still start).
    await markOutboxSent(run._id).catch((err) => console.warn(`[storyboard] run ${runId} queued, but its outbox wasn't marked sent:`, err instanceof Error ? err.message : err));
    return "queued";
  }
  if (env.isProduction) {
    await failRun(run._id, "JOB_NOT_STARTED");
    return "failed";
  }
  await markOutboxSent(run._id);
  (opts.schedule ?? afterResponse)(() =>
    runStoryboardJob(runId).catch(async (err) => {
      console.error(`[storyboard] run ${runId} failed:`, err);
      await failRun(run._id, "INTERNAL").catch(() => {});
    }),
  );
  return "inline";
}
