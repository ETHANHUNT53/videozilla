import { collections } from "../db/mongo";
import { env } from "../env";
import { purgeExpiredProjects } from "../repos/projects";
import { deletePrefix, projectPrefix } from "../storage/r2";
import { inngest } from "./inngest";

/** Daily cleanup (PRD F1-FR10): soft-deleted projects past their 30-day undo window are removed with their files. */
export const purgeDeletedProjects = inngest.createFunction(
  { id: "purge-deleted-projects", triggers: [{ cron: "TZ=Asia/Kolkata 30 3 * * *" }] },
  async ({ step }) => {
    const expired = await step.run("find-expired", async () => {
      const docs = await collections.projects().find({ purgeAt: { $lte: new Date() } }, { projection: { _id: 1, userId: 1 } }).toArray();
      return docs.map((d) => ({ id: d._id.toHexString(), userId: d.userId }));
    });
    if (env.r2.configured) {
      for (const p of expired) {
        await step.run(`delete-files-${p.id}`, () => deletePrefix(projectPrefix(p.userId, p.id)));
      }
    }
    const removed = await step.run("delete-documents", () => purgeExpiredProjects());
    return { removed };
  },
);

export const functions = [purgeDeletedProjects];
