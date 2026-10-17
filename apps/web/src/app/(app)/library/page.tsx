import type { Metadata } from "next";
import { Suspense } from "react";
import { createProjectAction } from "../actions";
import { LibraryGrid, LibraryToolbar } from "@/components/library";
import { Button, Eyebrow, Spinner } from "@/components/ui";
import { requireUser } from "@/server/dal";
import type { StatusGroup } from "@/server/db/types";
import { listProjects } from "@/server/repos/projects";

export const metadata: Metadata = { title: "Library" };

const GROUPS = new Set(["all", "drafts", "ready", "scheduled", "posted"]);

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
  const group = typeof params.filter === "string" && GROUPS.has(params.filter) ? (params.filter as StatusGroup | "all") : "all";
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const before = typeof params.before === "string" ? params.before : undefined;

  const [{ items, nextCursor }, attention, renderedAt] = await Promise.all([
    listProjects(user.id, { group, q, before }),
    group === "all" && !q && !before ? listProjects(user.id, { group: "attention" }) : Promise.resolve({ items: [], nextCursor: null }),
    readTime(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <LibraryToolbar filter={group} q={q} />
      {attention.items.length ? (
        <section className="flex flex-col gap-3">
          <Eyebrow accent="text-red">needs attention</Eyebrow>
          <LibraryGrid projects={attention.items} renderedAt={renderedAt} />
        </section>
      ) : null}
      <LibraryGrid renderedAt={renderedAt} projects={items.filter((p) => !attention.items.some((a) => a.id === p.id))} empty={!q && group === "all" && !before} searching={Boolean(q) || group !== "all"} />
      {nextCursor ? (
        <a href={`/library?${new URLSearchParams({ ...(group !== "all" ? { filter: group } : {}), ...(q ? { q } : {}), before: nextCursor })}`} className="self-center font-mono text-sm text-cyan hover:underline">
          Load older videos →
        </a>
      ) : null}
    </div>
  );
}
