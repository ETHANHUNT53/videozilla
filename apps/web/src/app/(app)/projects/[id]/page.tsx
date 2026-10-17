import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProjectView } from "@/components/project-view";
import { Spinner } from "@/components/ui";
import { toProject } from "@/server/api/resources";
import { requireUser } from "@/server/dal";
import { getProject } from "@/server/repos/projects";

export const metadata: Metadata = { title: "Video" };

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<Spinner label="Opening video…" />}>
      <ProjectContent params={params} />
    </Suspense>
  );
}

// The page reads through the same service and resource shape as GET /api/v1/projects/{id}; its edits go through
// PATCH /api/v1/projects/{id}.
async function ProjectContent({ params }: { params: PageProps<"/projects/[id]">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await getProject(user.id, id);
  // Unknown or someone else's project: 404, never a hint that it exists.
  if (!project) notFound();
  // Keyed by id only: after a save the page keeps its state (and "Saved" message); edits made in another tab
  // meanwhile are caught by If-Match (412 → the page loads the latest copy).
  return <ProjectView key={id} initial={toProject(project)} />;
}
