"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { clampChars, conflictCopy, patchProject } from "@/lib/project-client";
import { FILTERS, STATUS_DISPLAY, type ProjectStatus } from "@/lib/status";
import { TimeAgo } from "./time-ago";
import { Chip, cx, inputStyles } from "./ui";

interface Project {
  id: string;
  title: string;
  language: "en" | "hi";
  lengthPreset: 60 | 90;
  status: ProjectStatus;
  updatedAt: string;
  /** Revision, sent back as If-Match when renaming (API Design §8). */
  rev: number;
}

export function LibraryToolbar({ filter, q }: { filter: string; q: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (next: { filter?: string; q?: string }) => {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    const s = next.q ?? query;
    if (f !== "all") params.set("filter", f);
    if (s.trim()) params.set("q", s.trim());
    router.replace(`/library${params.size ? `?${params}` : ""}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => go({ filter: f.id })}
            className={cx("rounded-lg px-3 py-1.5 text-sm transition-colors", filter === f.id ? "bg-surface-hover text-fg" : "text-muted hover:text-fg")}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => go({ q: v }), 300);
        }}
        placeholder="Search by title"
        aria-label="Search videos by title"
        className={cx(inputStyles, "max-w-xs")}
      />
    </div>
  );
}

interface ProjectPage {
  items: Project[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * A library list: the server-rendered first page, then older pages loaded from `GET /api/v1/projects` with the cursor
 * (API Design §6.1). The first page always comes from the latest server render, so when an action revalidates the
 * Library the list shows the fresh data; pages loaded here are kept below it. Remount it (new `key`) when the filter
 * or search changes.
 */
export function LibraryFeed({
  initial,
  filter,
  q,
  excludeAttention = false,
  renderedAt,
  timeZone,
  empty = false,
  searching = false,
}: {
  initial: ProjectPage;
  filter: string;
  q: string;
  /** Leave out needs-attention projects (the page shows them in their own section); must match the first page. */
  excludeAttention?: boolean;
  renderedAt: number;
  timeZone: string;
  empty?: boolean;
  searching?: boolean;
}) {
  // Older pages loaded in the browser, and the cursor after the last of them (null: nothing loaded yet).
  const [older, setOlder] = useState<Project[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a second click before React has re-rendered with `loading`.
  const inFlight = useRef(false);

  const cursor = olderCursor === undefined ? initial.nextCursor : olderCursor;
  const firstIds = new Set(initial.items.map((p) => p.id));
  const items = [...initial.items, ...older.filter((p) => !firstIds.has(p.id))];

  const loadMore = async () => {
    if (!cursor || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cursor });
      if (filter !== "all") params.set("filter", filter);
      if (q) params.set("q", q);
      if (excludeAttention) params.set("exclude", "attention");
      const { data: page } = await apiCall<ProjectPage>(`/api/v1/projects?${params}`);
      setOlder((prev) => [...prev, ...page.items.filter((n) => !prev.some((p) => p.id === n.id))]);
      setOlderCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't load more videos. Please try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <LibraryGrid projects={items} renderedAt={renderedAt} timeZone={timeZone} empty={empty} searching={searching} />
      {cursor ? (
        <button onClick={loadMore} disabled={loading} className="self-center font-mono text-sm text-cyan hover:underline disabled:opacity-60">
          {loading ? "Loading…" : "Load older videos →"}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="self-center text-sm text-red">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function LibraryGrid({
  projects,
  renderedAt,
  timeZone,
  empty = false,
  searching = false,
}: {
  projects: Project[];
  renderedAt: number;
  timeZone: string;
  empty?: boolean;
  searching?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  // The latest server copy of each card that changed here (rename, restore). A card that is hidden and shown again
  // mounts afresh, so it must start from this, not from the first render's list.
  const [latest, setLatest] = useState<Record<string, Project>>({});
  const remember = (project: Project) => setLatest((l) => ({ ...l, [project.id]: project }));
  const router = useRouter();
  // Re-render the Library (and drop cached pages) after a change here, so Back and the project page show it too.
  const refresh = () => router.refresh();

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(t);
  }, [undo]);

  // Whichever copy is newer: the one remembered here after a change, or a fresher one from the server (a refresh, or a
  // change made elsewhere). On equal revisions the server's copy wins.
  const visible = projects.filter((p) => !hidden.has(p.id)).map((p) => (latest[p.id] && latest[p.id].rev > p.rev ? latest[p.id] : p));

  if (!visible.length && !undo) {
    if (searching) return <p className="py-10 text-center text-muted">No videos match.</p>;
    return empty ? <EmptyState /> : null;
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            renderedAt={renderedAt}
            timeZone={timeZone}
            onSaved={(project) => {
              remember(project);
              refresh();
            }}
            onDeleted={(title) => {
              setHidden((h) => new Set(h).add(p.id));
              setUndo({ id: p.id, title });
              refresh();
            }}
            onDuplicated={(id) => router.push(`/projects/${id}`)}
          />
        ))}
      </div>
      {undo ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" role="status">
          <div className="flex items-center gap-4 rounded-xl border border-line-strong bg-raised px-4 py-3 text-sm shadow-2xl">
            <span>
              Deleted <span className="text-fg">“{undo.title}”</span>
            </span>
            <button
              className="font-medium text-cyan hover:underline"
              onClick={async () => {
                const id = undo.id;
                setUndo(null);
                setUndoError(null);
                try {
                  const { data } = await apiCall<Project>(`/api/v1/projects/${id}/restore`, { method: "POST" });
                  remember(data); // restore bumps rev (and may change the status), so the card must use the new copy
                  setHidden((h) => {
                    const n = new Set(h);
                    n.delete(id);
                    return n;
                  });
                  refresh();
                } catch (err) {
                  setUndoError(err instanceof ApiClientError ? err.message : "Couldn't undo. Please try again.");
                }
              }}
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}
      {undoError ? (
        <p role="alert" className="self-center text-sm text-red">
          {undoError}
        </p>
      ) : null}
    </>
  );
}

function ProjectCard({
  project,
  renderedAt,
  timeZone,
  onSaved,
  onDeleted,
  onDuplicated,
}: {
  project: Project;
  renderedAt: number;
  timeZone: string;
  onSaved: (project: Project) => void;
  onDeleted: (title: string) => void;
  onDuplicated: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  // The title and revision last saved on the server.
  const [saved, setSaved] = useState({ title: project.title, rev: project.rev });
  // A newer copy arrived from the server (a refresh, or a change in another tab): take it, so the next rename sends
  // the current rev instead of failing with 412. Adjusting state during render, as React recommends for this.
  if (project.rev > saved.rev) {
    setSaved({ title: project.title, rev: project.rev });
    if (!editing) setTitle(project.title);
  }
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const status = STATUS_DISPLAY[project.status];

  const fail = (err: unknown, fallback: string) => setNote(err instanceof ApiClientError ? err.message : fallback);

  // Enter saves and removes the input, and its blur can then fire save again from the same render: only the first
  // call per edit may send a PATCH (a second one with the same If-Match would come back 412).
  const savingEdit = useRef(false);

  const saveTitle = () => {
    if (savingEdit.current) return;
    savingEdit.current = true;
    setEditing(false);
    const clean = title.trim();
    if (!clean || clean === saved.title) {
      setTitle(saved.title);
      return;
    }
    setNote(null);
    start(async () => {
      try {
        // If-Match: don't overwrite a change made in another tab meanwhile (412 → show the latest title).
        const { project: data } = await patchProject<Project>({ id: project.id, rev: saved.rev }, { title: clean });
        setSaved({ title: data.title, rev: data.rev });
        setTitle(data.title);
        onSaved({ ...project, ...data });
      } catch (err) {
        const current = conflictCopy<Project>(err);
        if (current) {
          setSaved({ title: current.title, rev: current.rev });
          setTitle(current.title);
          onSaved({ ...project, ...current });
          setNote("This video was changed in another tab, so your rename wasn't saved. Try again.");
        } else {
          setTitle(saved.title);
          fail(err, "Couldn't rename this video. Please try again.");
        }
      }
    });
  };

  return (
    <div className={cx("group relative flex flex-col rounded-2xl border border-line bg-surface transition-colors hover:border-line-strong", pending && "opacity-60")}>
      <Link href={`/projects/${project.id}`} className="relative block aspect-[9/10] overflow-hidden rounded-t-2xl bg-raised" aria-label={`Open ${project.title}`}>
        <div className="dot-field absolute inset-0 opacity-60" />
        <div className="absolute inset-x-5 top-6 font-mono text-xs text-muted">
          <span className="text-cyan">{"// "}</span>
          {project.language === "hi" ? "हिंदी" : "english"} · ~{project.lengthPreset}s
        </div>
        <p className="absolute inset-x-5 top-12 line-clamp-3 text-balance text-xl font-semibold leading-tight">{title}</p>
      </Link>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(clampChars(e.target.value))}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  savingEdit.current = true; // cancelled: the blur that follows must not save the typed text
                  setTitle(saved.title);
                  setEditing(false);
                }
              }}
              className={cx(inputStyles, "py-1")}
              aria-label="Video title"
            />
          ) : (
            <p className="truncate text-sm font-medium" title={title}>
              {title}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Chip color={status.color}>{status.label}</Chip>
            <TimeAgo iso={project.updatedAt} renderedAt={renderedAt} timeZone={timeZone} className="font-mono text-xs text-dim" />
          </div>
          {note ? (
            <p role="alert" className="text-xs text-red">
              {note}
            </p>
          ) : null}
        </div>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="rounded-lg px-2 py-1 text-muted hover:bg-surface-hover hover:text-fg" aria-label="Video actions" aria-expanded={menu}>
            ⋯
          </button>
          {menu ? (
            <div className="absolute bottom-full right-0 z-20 mb-2 flex w-40 flex-col rounded-xl border border-line-strong bg-raised p-1 text-sm shadow-2xl" onMouseLeave={() => setMenu(false)}>
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  savingEdit.current = false;
                  setEditing(true);
                }}
              >
                Rename
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  setNote(null);
                  start(async () => {
                    try {
                      const { data } = await apiCall<{ id: string }>(`/api/v1/projects/${project.id}/duplicate`, { method: "POST" });
                      router.refresh(); // so Back shows the copy in the Library
                      onDuplicated(data.id);
                    } catch (err) {
                      fail(err, "Couldn't duplicate this video. Please try again.");
                    }
                  });
                }}
              >
                Duplicate
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  setMenu(false);
                  setNote(null);
                  start(async () => {
                    try {
                      await apiCall(`/api/v1/projects/${project.id}`, { method: "DELETE" });
                      onDeleted(saved.title);
                    } catch (err) {
                      // e.g. 409 PUBLISH_IN_PROGRESS while it's being posted to Instagram (DB Design §5.2).
                      fail(err, "Couldn't delete this video. Reload and try again.");
                    }
                  });
                }}
              >
                Delete
              </MenuItem>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx("rounded-lg px-3 py-2 text-left hover:bg-surface-hover", danger ? "text-red" : "text-fg")}>
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted">
        <span className="text-cyan">{"// "}</span>no videos yet
      </p>
      <p className="max-w-md text-balance text-2xl font-semibold">Create your first explainer</p>
      <p className="max-w-md text-balance text-muted">
        Try <span className="text-fg">“How do vaccines work?”</span>, <span className="text-fg">“What is compound interest?”</span> or{" "}
        <span className="text-fg">“प्रकाश संश्लेषण कैसे होता है?”</span>
      </p>
    </div>
  );
}
