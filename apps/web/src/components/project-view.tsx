"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { clampChars, conflictCopy, currentNote, patchProject, type RevNote } from "@/lib/project-client";
import { STEPS, stepIndex } from "@/lib/project-options";
import { staleMessage, type StaleAction } from "@/lib/storyboard-run";
import { STATUS_DISPLAY } from "@/lib/status";
import type { ChatMessageResource, IdeaSessionResource, ProjectResource, RunResource, StoryboardVersionResource } from "@/server/api/resources";
import { IdeaStep } from "./idea-step";
import { SettingsPanel } from "./settings-panel";
import { StoryboardReview } from "./storyboard-review";
import { StoryboardWorkspace, useStoryboardRun } from "./storyboard-run";
import { Button, Card, Chip, Eyebrow, Slashes, cx, inputStyles } from "./ui";

type Project = ProjectResource;

/** What the Video step's workspace will hold; a placeholder until those milestones land. */
const VIDEO_WORKSPACE = {
  eyebrow: "video",
  title: "Preview, export and post",
  body: "Watch the preview with voice and motion graphics, export the final MP4 and post it to Instagram. Arriving in M4–M6.",
} as const;

/**
 * The project page (PRD S4 shell, Stitch screen 07): title, status, the Idea → Storyboard → Video stepper, a
 * "needs attention" banner, the step's workspace and the settings panel. Reads and writes go through `/api/v1`.
 */
export function ProjectView(props: {
  initial: Project;
  idea: IdeaSessionResource;
  chat: { items: ChatMessageResource[]; hasOlder: boolean };
  /** The latest storyboard generation run (F3.1), to follow one that is running or show why the last one failed. */
  storyboardRun?: RunResource | null;
  /** The current storyboard version, once there is one (the Storyboard Review screen, F3.3). */
  storyboard?: StoryboardVersionResource | null;
}) {
  const { initial, idea, chat, storyboard: version = null } = props;
  const [project, setProject] = useState(initial);
  // A newer copy from the server (router.refresh() after a save, or a change made elsewhere) replaces the local one;
  // on equal revisions the local copy stays. Adjusting state during render, as React recommends for this.
  if (initial.rev > project.rev) setProject(initial);
  const router = useRouter();
  const step = stepIndex(project.status, project.attention?.kind);
  const status = STATUS_DISPLAY[project.status];
  // The step being looked at: the video's own step, or an earlier one opened in the stepper ("Back to idea"). When the
  // video's status changes (a storyboard starts or ends), the video's own step shows again.
  const [viewing, setViewing] = useState<number | null>(null);
  const [seenStatus, setSeenStatus] = useState(project.status);
  if (seenStatus !== project.status) {
    // Adjusting state during render, as above: any status change (a regenerate starting, then ending) resets the view.
    setSeenStatus(project.status);
    setViewing(null);
  }
  const shown = viewing !== null && viewing <= step ? viewing : step;

  const saved = (next: Project) => {
    setProject(next);
    router.refresh(); // keep the Library and this page's server copy in step
  };
  // A 409 from an action means this tab is behind (another tab generated a storyboard, say): load the video as it is
  // now; the refresh also brings the latest run and storyboard summary (QA, F3.1).
  // A line says what happened (nothing is dropped silently); it stays until dismissed or the next Generate, even when
  // the other tab's storyboard finishes meanwhile.
  const [staleText, setStaleNote] = useState<string | null>(null);
  const resync = async (action: StaleAction) => {
    try {
      const { data } = await apiCall<Project>(`/api/v1/projects/${project.id}`);
      saved(data);
      setStaleNote(staleMessage(action));
    } catch {
      router.refresh();
      setStaleNote(staleMessage(action));
    }
  };
  const run = useStoryboardRun(project.id, props.storyboardRun ?? null, saved, resync);
  const storyboardRun = {
    ...run,
    start: (regenerate: boolean) => {
      setStaleNote(null); // the user's next action
      return run.start(regenerate);
    },
  };
  const hasStoryboard = Boolean(project.currentStoryboardVersion) && project.status !== "storyboard_generating";
  // The Storyboard Review screen (F3.3) shows on the Storyboard step once the storyboard is there.
  const reviewing = shown === 1 && hasStoryboard && version !== null && version.version === project.currentStoryboardVersion;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/library" className="font-mono text-sm text-muted hover:text-fg">
          ← library
        </Link>
        {/* Below lg the title has its own row and wraps; the status chip and "Next: Storyboard" go on the row under it
            (QA, F2.7: in one row the title shrank to nothing at 768 and 360 px). From lg it's one row: the title, cut
            with "…" (full text on hover), then the chip, with "Next: Storyboard" top-right. The title-and-chip group is
            `contents` below lg, so its two parts take part in the outer rows. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:items-center lg:gap-3">
            <div className="min-w-0 basis-full lg:basis-auto">
              <ProjectTitle project={project} onSaved={saved} />
            </div>
            <Chip color={status.color}>{status.label}</Chip>
          </div>
          {/* The way forward: on the Idea step, to the storyboard once there is one; on the Storyboard step (Stitch 10),
              "Approve & create video", shown disabled until building arrives in M3 (your answer, F3.3). */}
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {reviewing ? (
              <>
                <span id="approve-note" className="hidden font-mono text-xs text-muted sm:inline">
                  <Slashes />
                  Building the video arrives in M3
                </span>
                <Button type="button" disabled aria-describedby="approve-note" title="Building the video arrives in M3">
                  Approve &amp; create video →
                </Button>
              </>
            ) : hasStoryboard ? (
              <Button type="button" onClick={() => setViewing(null)}>
                Next: Storyboard →
              </Button>
            ) : (
              <Button type="button" disabled title={project.status === "storyboard_generating" ? "Your storyboard is being written" : "Generate the storyboard first"}>
                Next: Storyboard →
              </Button>
            )}
          </span>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === shown ? "step" : undefined}
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
              <span className={cx("font-mono text-xs", i === step ? "text-cyan" : "text-muted")}><Slashes />
                {i === step ? "active phase" : i < step ? "done ✓" : s.hint.replace(/^\/\/ /, "")}</span>
            </span>
            <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", i === step ? "bg-cyan shadow-[0_0_8px_var(--cyan)]" : i < step ? "bg-cyan/60" : "bg-line-strong")} />
            {/* An earlier step can be opened again (e.g. the idea and brief behind a ready storyboard). */}
            {i < step && i !== shown ? (
              <button type="button" className="font-mono text-xs text-muted hover:text-fg" onClick={() => setViewing(i)}>
                open<span className="sr-only"> the {s.label} step</span>
              </button>
            ) : i === step && shown !== step ? (
              <button type="button" className="font-mono text-xs text-muted hover:text-fg" onClick={() => setViewing(null)}>
                back<span className="sr-only"> to the {s.label} step</span>
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      {/* Polite: it follows the user's own action, and the page around it has just changed. */}
      <div aria-live="polite">
        {staleText ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-orange/40 bg-orange/5 px-4 py-3 text-sm">
            <p>{staleText}</p>
            <button type="button" className="font-mono text-xs text-muted hover:text-fg" onClick={() => setStaleNote(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ) : null}
      </div>

      {project.attention ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-red/40 bg-red/5 px-4 py-3">
          <span className="font-mono text-xs text-red"><Slashes />
            needs attention</span>
          <span className="text-sm">{project.attention.message}</span>
        </div>
      ) : null}

      {shown === 0 ? (
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
          status={project.status}
          storyboard={storyboardRun}
          onStale={resync}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          {reviewing ? (
            <StoryboardReview project={project} version={version!} storyboard={storyboardRun} onBackToIdea={() => setViewing(0)} />
          ) : shown === 1 ? (
            <StoryboardWorkspace status={project.status} storyboard={storyboardRun} />
          ) : (
            <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
              <Eyebrow accent="text-violet">{VIDEO_WORKSPACE.eyebrow}</Eyebrow>
              <p className="text-balance text-2xl font-semibold">{VIDEO_WORKSPACE.title}</p>
              <p className="max-w-md text-balance text-muted">{VIDEO_WORKSPACE.body}</p>
            </Card>
          )}
          <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-4 lg:self-start">
            <SettingsPanel project={project} onSaved={saved} />
            {reviewing ? (
              // Stitch 10's chat column: the revision chat arrives in M5 (your answer, F3.3).
              <Card className="flex flex-col gap-2 p-5">
                <Eyebrow accent="text-violet">revise with ai</Eyebrow>
                <p className="text-sm text-muted">Ask for changes in plain words, for the whole video or one scene. Arrives in M5; until then, edit the brief and regenerate.</p>
              </Card>
            ) : null}
          </div>
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
        // Wraps below lg (a long word breaks anywhere rather than overflow); one line with "…" from lg, the full title
        // on hover then.
        <h1 className={cx("min-w-0 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] lg:truncate", pending && "opacity-60")} title={canRename ? undefined : project.title}>
          {canRename ? (
            <button type="button" onClick={startEdit} className="block max-w-full text-left hover:text-cyan lg:truncate" title={`Rename: ${project.title}`}>
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
