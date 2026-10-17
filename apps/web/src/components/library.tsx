"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteProjectAction, duplicateProjectAction, renameProjectAction, restoreProjectAction } from "@/app/(app)/actions";
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

export function LibraryGrid({ projects, renderedAt, empty = false, searching = false }: { projects: Project[]; renderedAt: number; empty?: boolean; searching?: boolean }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(t);
  }, [undo]);

  const visible = projects.filter((p) => !hidden.has(p.id));

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
            onDeleted={() => {
              setHidden((h) => new Set(h).add(p.id));
              setUndo({ id: p.id, title: p.title });
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
                await restoreProjectAction(id);
                setHidden((h) => {
                  const n = new Set(h);
                  n.delete(id);
                  return n;
                });
              }}
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProjectCard({ project, renderedAt, onDeleted, onDuplicated }: { project: Project; renderedAt: number; onDeleted: () => void; onDuplicated: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [menu, setMenu] = useState(false);
  const [pending, start] = useTransition();
  const status = STATUS_DISPLAY[project.status];

  const saveTitle = () => {
    setEditing(false);
    const clean = title.trim();
    if (!clean || clean === project.title) {
      setTitle(project.title);
      return;
    }
    start(async () => {
      const { ok } = await renameProjectAction(project.id, clean);
      if (!ok) setTitle(project.title);
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
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitle(project.title);
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
            <TimeAgo iso={project.updatedAt} renderedAt={renderedAt} className="font-mono text-xs text-dim" />
          </div>
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
                  setEditing(true);
                }}
              >
                Rename
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  start(async () => {
                    const { id } = await duplicateProjectAction(project.id);
                    if (id) onDuplicated(id);
                  });
                }}
              >
                Duplicate
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  setMenu(false);
                  start(async () => {
                    const { ok } = await deleteProjectAction(project.id);
                    if (ok) onDeleted();
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
