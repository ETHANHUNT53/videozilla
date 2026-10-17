import type { Migration } from "../src/migrate";

/**
 * 003 — every project has exactly one idea session (DB Design §4.4, §6.1). From F1.7 they are created together in one
 * transaction; this gives the projects made before that (M1 draft, including soft-deleted ones that can still be
 * restored) an empty session. Safe to re-run: projects that already have one are skipped. Frozen once applied.
 */
export default {
  async up({ db, log }) {
    const now = new Date();
    const projects = db.collection("projects").aggregate<{ _id: unknown; userId: string; createdAt: Date }>([
      { $lookup: { from: "idea_sessions", localField: "_id", foreignField: "projectId", as: "idea", pipeline: [{ $project: { _id: 1 } }] } },
      { $match: { idea: { $size: 0 } } },
      { $project: { userId: 1, createdAt: 1 } },
    ]);
    let created = 0;
    for await (const p of projects) {
      await db.collection("idea_sessions").updateOne(
        { projectId: p._id },
        {
          $setOnInsert: {
            projectId: p._id,
            userId: p.userId,
            schemaVersion: 1,
            mode: "topic",
            topicInput: "",
            ideaInput: "",
            notesText: "",
            suggestions: [],
            brief: null,
            briefUpdatedAt: null,
            rev: 0,
            createdAt: p.createdAt ?? now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      created++;
    }
    log(`idea sessions created for ${created} existing project(s)`);
  },
} satisfies Migration;
