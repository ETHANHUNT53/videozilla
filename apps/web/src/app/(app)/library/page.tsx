import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LibraryFeed, LibraryToolbar } from "@/components/library";
import { CreateVideoButton } from "@/components/create-video-button";
import { Eyebrow, Spinner } from "@/components/ui";
import { requireUser } from "@/server/dal";
import type { ProjectFilter } from "@/server/db/types";
import { getOrCreateProfile } from "@/server/repos/profiles";
import { listProjects, normalizeSearch } from "@/server/repos/projects";

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
        <CreateVideoButton />
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
  // Cleaned exactly like the API cleans it, so the first page's cursor also works for "Load older videos".
  const q = normalizeSearch(typeof params.q === "string" ? params.q : undefined) ?? "";
  const showAttention = filter === "all" && !q;

  // The first page is read here through the same service as GET /api/v1/projects; "Load older videos" fetches the
  // next pages from that endpoint with the returned cursor.
  const [page, attention, renderedAt, profile] = await Promise.all([
    // With the attention section shown, the main list leaves those projects out in the query itself, so they never
    // appear twice and every page of the main list is a full page.
    listProjects(user.id, { filter, q: q || undefined, excludeAttention: showAttention }),
    showAttention ? listProjects(user.id, { filter: "attention" }) : Promise.resolve(null),
    readTime(),
    getOrCreateProfile(user.id, user.name), // its time zone dates older cards the same on the server and in the browser
  ]);
  // First visit: the Welcome screen once (F1.12). Only the Library sends there, so deep links are never interrupted.
  if (!profile.onboardingCompletedAt) redirect("/welcome");

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
        excludeAttention={showAttention}
        renderedAt={renderedAt}
        timeZone={profile.timezone}
        empty={showAttention && !attention?.items.length}
        searching={!showAttention}
      />
    </div>
  );
}
