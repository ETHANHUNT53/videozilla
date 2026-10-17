import type { Metadata } from "next";
import { Suspense } from "react";
import { createProjectAction } from "../actions";
import { LibraryFeed, LibraryToolbar } from "@/components/library";
import { Button, Eyebrow, Spinner } from "@/components/ui";
import { requireUser } from "@/server/dal";
import type { ProjectFilter } from "@/server/db/types";
import { getOrCreateProfile } from "@/server/repos/profiles";
import { listProjects } from "@/server/repos/projects";

export const metadata: Metadata = { title: "Library" };

/** The filter tabs on the page ("attention" has its own section instead of a tab). */
const FILTERS = new Set<string>(["all", "drafts", "ready", "scheduled", "posted"]);

export default function LibraryPage({ searchParams }: PageProps<"/library">) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>library</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight">Your videos</h1>
        </div>
        <form action={createProjectAction}>
          <Button type="submit" className="px-5">
            + Create video
          </Button>
        </form>
      </div>
      <Suspense fallback={<Spinner label="Loading your videos…" />}>
        <LibraryContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// The time the list was read. The cards' "2 min ago" labels render from it on the server and again while hydrating,
// so both sides produce the same text; the browser's clock takes over once the page is live.
async function readTime() {
  return Date.now();
}

async function LibraryContent({ searchParams }: { searchParams: PageProps<"/library">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  const filter = typeof params.filter === "string" && FILTERS.has(params.filter) ? (params.filter as ProjectFilter) : "all";
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const showAttention = filter === "all" && !q;

  // The first page is read here through the same service as GET /api/v1/projects; "Load older videos" fetches the
  // next pages from that endpoint with the returned cursor.
  const [page, attention, renderedAt, profile] = await Promise.all([
    listProjects(user.id, { filter, q: q || undefined }),
    showAttention ? listProjects(user.id, { filter: "attention" }) : Promise.resolve(null),
    readTime(),
    getOrCreateProfile(user.id, user.name), // its time zone dates older cards the same on the server and in the browser
  ]);

  return (
    <div className="flex flex-col gap-6">
      <LibraryToolbar filter={filter} q={q} />
      {attention?.items.length ? (
        <section className="flex flex-col gap-3">
          <Eyebrow accent="text-red">needs attention</Eyebrow>
          <LibraryFeed key="attention" initial={attention} filter="attention" q="" renderedAt={renderedAt} timeZone={profile.timezone} />
        </section>
      ) : null}
      <LibraryFeed
        key={`${filter}|${q}`}
        initial={page}
        filter={filter}
        q={q}
        hideIds={attention?.items.map((a) => a.id)}
        renderedAt={renderedAt}
        timeZone={profile.timezone}
        empty={showAttention && !attention?.items.length}
        searching={!showAttention}
      />
    </div>
  );
}
