import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectView } from "@/components/project-view";
import { toIdeaSession, toProject } from "@/server/api/resources";
import { requireUser } from "@/server/dal";
import { latestIdeaChat } from "@/server/repos/chat-messages";
import { getIdea } from "@/server/repos/ideas";
import { getProject } from "@/server/repos/projects";

export const metadata: Metadata = { title: "Video" };

/**
 * The page waits for its two small reads before sending anything (no Suspense boundary), so an unknown or someone
 * else's id gets a real HTTP 404 and a signed-out visitor a real redirect: once a page starts streaming its status is
 * fixed at 200. That makes navigation to it block until the data is there; the Library cards show "opening…" meanwhile
 * (useLinkStatus). `instant = false` only opts this route out of Next.js's development-time instant-navigation check,
 * which would otherwise flag the blocking reads; it doesn't change how the page renders.
 */
export const instant = false;

// The page reads through the same services and resource shapes as GET /api/v1/projects/{id} and …/idea; its edits go
// through the API.
export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [project, idea] = await Promise.all([getProject(user.id, id), getIdea(user.id, id)]);
  // Unknown or someone else's project: 404, never a hint that it exists.
  if (!project || !idea) notFound();
  // The newest page of the idea chat (F2.5), so the thread shows without a second request.
  const chat = await latestIdeaChat(user.id, project._id, 50);
  // Keyed by id only, so a save keeps the page's state (and "Saved" message). A newer copy from a refresh replaces the
  // local one (higher rev wins); edits made in another tab meanwhile are caught by If-Match (412 → the latest copy).
  return <ProjectView key={id} initial={toProject(project)} idea={toIdeaSession(idea)} chat={chat} />;
}
