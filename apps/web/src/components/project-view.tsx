"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ApiClientError } from "@/lib/api-client";
import { clampChars, conflictCopy, currentNote, patchProject, type RevNote } from "@/lib/project-client";
import { STEPS, stepIndex } from "@/lib/project-options";
import { STATUS_DISPLAY } from "@/lib/status";
import type { ChatMessageResource, IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { IdeaStep } from "./idea-step";
import { SettingsPanel } from "./settings-panel";
import { Button, Card, Chip, Eyebrow, cx, inputStyles } from "./ui";

type Project = ProjectResource;

/** What the later steps' workspaces will hold; placeholders until those milestones land. The idea step is IdeaStep. */
const WORKSPACE = [
  null,
  {
    eyebrow: "storyboard",
    title: "Review your scenes",
    body: "Read the script scene by scene, ask for changes in plain words, then approve it to build the video. Arriving in M3.",
  },
  {
    eyebrow: "video",
    title: "Preview, export and post",
    body: "Watch the preview with voice and motion graphics, export the final MP4 and post it to Instagram. Arriving in M4–M6.",
  },
] as const;

/**
 * The project page (PRD S4 shell, Stitch screen 07): title, status, the Idea → Storyboard → Video stepper, a
 * "needs attention" banner, the step's workspace and the settings panel. Reads and writes go through `/api/v1`.
 */
export function ProjectView({ initial, idea, chat }: { initial: Project; idea: IdeaSessionResource; chat: { items: ChatMessageResource[]; hasOlder: boolean } }) {
  const [project, setProject] = useState(initial);
  // A newer copy from the server (router.refresh() after a save, or a change made elsewhere) replaces the local one;
  // on equal revisions the local copy stays. Adjusting state during render, as React recommends for this.
  if (initial.rev > project.rev) setProject(initial);
  const router = useRouter();
  const step = stepIndex(project.status, project.attention?.kind);
  const status = STATUS_DISPLAY[project.status];

  const saved = (next: Project) => {
    setProject(next);
    router.refresh(); // keep the Library and this page's server copy in step
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/library" className="font-mono text-sm text-muted hover:text-fg">
          ← library
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <ProjectTitle project={project} onSaved={saved} />
            <Chip color={status.color}>{status.label}</Chip>
          </div>
          {/* Stitch 09's way forward; the storyboard step arrives with F3 (your answer, F2.7). */}
          <span className="flex items-center gap-3">
            <span className="hidden font-mono text-xs text-muted sm:inline">{"// next milestone"}</span>
            <Button type="button" disabled title="The storyboard step arrives in the next milestone">
              Next: Storyboard →
            </Button>
          </span>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === step ? "step" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-xl border px-4 py-3",
              i === step ? "border-cyan/60 bg-cyan/5" : i < step ? "border-line bg-surface" : "border-line",
            )}
          >
            {/* Stitch 09: the number in a small square, then the label and its hint, and a status dot. */}
            <span
              className={cx(
                "grid size-8 shrink-0 place-items-center rounded-lg border font-mono text-xs",
                i === step ? "border-cyan/40 bg-cyan/10 text-cyan" : i < step ? "border-line text-cyan" : "border-line text-muted",
              )}
            >
              {s.n}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cx("text-sm font-medium", i > step && "text-muted")}>{s.label}</span>
              <span className={cx("font-mono text-xs", i === step ? "text-cyan" : "text-muted")}>{i === step ? "// active phase" : i < step ? "// done ✓" : s.hint}</span>
            </span>
            <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", i === step ? "bg-cyan shadow-[0_0_8px_var(--cyan)]" : i < step ? "bg-cyan/60" : "bg-line-strong")} />
          </li>
        ))}
      </ol>

      {project.attention ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-red/40 bg-red/5 px-4 py-3">
          <span className="font-mono text-xs text-red">{"// needs attention"}</span>
          <span className="text-sm">{project.attention.message}</span>
        </div>
      ) : null}

      {step === 0 ? (
        // The Idea Studio (Stitch 09, F2.7) lays out both columns: ideas on the left; the brief, its chat, these settings
        // and "Generate storyboard" on the right.
        <IdeaStep
          projectId={project.id}
          language={project.language}
          lengthSec={project.lengthPreset}
          initial={idea}
          initialChat={chat}
          editable={project.allowedActions.includes("edit_idea")}
          onProject={saved}
          settings={<SettingsPanel project={project} onSaved={saved} />}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
            <Eyebrow accent="text-violet">{WORKSPACE[step].eyebrow}</Eyebrow>
            <p className="text-balance text-2xl font-semibold">{WORKSPACE[step].title}</p>
            <p className="max-w-md text-balance text-muted">{WORKSPACE[step].body}</p>
          </Card>
          <SettingsPanel project={project} onSaved={saved} />
        </div>
      )}
    </div>
  );
}

function ProjectTitle({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [editing, setEditing] = useState(false);
  // The text being typed; outside an edit (and its save) the heading shows project.title, so a newer copy of the
  // project (e.g. loaded after a 412 in the settings panel) always shows its own title.
  const [title, setTitle] = useState(project.title);
  // Tied to the revision it is about, so a later successful save (title or settings) hides it.
  const [revNote, setNote] = useState<RevNote | null>(null);
  const note = currentNote(revNote, project);
  const [pending, start] = useTransition();
  const canRename = project.allowedActions.includes("rename");
  // Enter saves and removes the input, and its blur can then fire save again from the same render: only the first call
  // per edit may send a PATCH (a second one with the same If-Match would come back 412). Escape also ends the edit.
  const ended = useRef(false);

  const startEdit = () => {
    ended.current = false;
    setTitle(project.title);
    setNote(null);
    setEditing(true);
  };

  const save = () => {
    if (ended.current) return;
    ended.current = true;
    setEditing(false);
    const clean = title.trim();
    if (!clean || clean === project.title) {
      setTitle(project.title);
      return;
    }
    setNote(null);
    start(async () => {
      try {
        const { project: next } = await patchProject<Project>(project, { title: clean });
        setTitle(next.title);
        onSaved(next);
      } catch (err) {
        const current = conflictCopy<Project>(err);
        if (current) onSaved(current);
        setTitle(current?.title ?? project.title);
        setNote({
          value: current ? "This video was changed in another tab, so your rename wasn't saved. Try again." : err instanceof ApiClientError ? err.message : "Couldn't rename this video.",
          rev: (current ?? project).rev,
        });
      }
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(clampChars(e.target.value))}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              ended.current = true; // cancelled: the blur that follows must not save the typed text
              setTitle(project.title);
              setEditing(false);
            }
          }}
          className={cx(inputStyles, "text-2xl font-semibold")}
          aria-label="Video title"
        />
      ) : (
        <h1 className={cx("text-3xl font-semibold tracking-tight", pending && "opacity-60")}>
          {canRename ? (
            <button type="button" onClick={startEdit} className="text-left hover:text-cyan" title="Rename">
              {pending ? title : project.title}
            </button>
          ) : (
            project.title
          )}
        </h1>
      )}
      {note ? (
        <p role="alert" className="text-sm text-red">
          {note}
        </p>
      ) : null}
    </div>
  );
}
