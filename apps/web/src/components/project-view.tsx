"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ApiClientError } from "@/lib/api-client";
import { clampChars, conflictCopy, currentNote, patchProject, type RevNote } from "@/lib/project-client";
import {
  AUDIENCE_OPTIONS,
  BOARD_OPTIONS,
  LANGUAGE_OPTIONS,
  LENGTH_OPTIONS,
  STEPS,
  STYLE_LABELS,
  VOICE_OPTIONS,
  labelOf,
  stepIndex,
} from "@/lib/project-options";
import { STATUS_DISPLAY } from "@/lib/status";
import type { IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { IdeaStep } from "./idea-step";
import { Button, Card, Chip, Eyebrow, Select, cx, inputStyles } from "./ui";

type Project = ProjectResource;
type Settings = Pick<Project, "language" | "lengthPreset" | "audience" | "boardOrExam" | "voiceGender" | "captionsEnabled">;

const SETTING_KEYS = ["language", "lengthPreset", "audience", "boardOrExam", "voiceGender", "captionsEnabled"] as const;
const settingsOf = (p: Project): Settings => ({
  language: p.language,
  lengthPreset: p.lengthPreset,
  audience: p.audience,
  boardOrExam: p.boardOrExam,
  voiceGender: p.voiceGender,
  captionsEnabled: p.captionsEnabled,
});

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
export function ProjectView({ initial, idea }: { initial: Project; idea: IdeaSessionResource }) {
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
        <div className="flex flex-wrap items-center gap-3">
          <ProjectTitle project={project} onSaved={saved} />
          <Chip color={status.color}>{status.label}</Chip>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === step ? "step" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-xl border px-4 py-3",
              i === step ? "border-cyan/60 bg-cyan/5" : i < step ? "border-line bg-surface" : "border-line text-dim",
            )}
          >
            <span className={cx("font-mono text-xs", i <= step ? "text-cyan" : "text-dim")}>{s.n}</span>
            <span className="flex flex-col">
              <span className="text-sm font-medium">{s.label}</span>
              <span className={cx("font-mono text-xs", i === step ? "text-cyan" : "text-dim")}>{i === step ? "// active phase" : i < step ? "// done ✓" : s.hint}</span>
            </span>
          </li>
        ))}
      </ol>

      {project.attention ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-red/40 bg-red/5 px-4 py-3">
          <span className="font-mono text-xs text-red">{"// needs attention"}</span>
          <span className="text-sm">{project.attention.message}</span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {step === 0 ? (
          <IdeaStep projectId={project.id} initial={idea} editable={project.allowedActions.includes("edit_idea")} />
        ) : (
          <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
            <Eyebrow accent="text-violet">{WORKSPACE[step].eyebrow}</Eyebrow>
            <p className="text-balance text-2xl font-semibold">{WORKSPACE[step].title}</p>
            <p className="max-w-md text-balance text-muted">{WORKSPACE[step].body}</p>
          </Card>
        )}
        <SettingsPanel project={project} onSaved={saved} />
      </div>
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

function SettingsPanel({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Settings>(settingsOf(project));
  // Tied to the revision it is about, like the title's note: a later rename hides it.
  const [revMessage, setMessage] = useState<RevNote<{ tone: "info" | "error"; text: string }> | null>(null);
  const message = currentNote(revMessage, project);
  const [pending, start] = useTransition();
  const scriptEditable = project.allowedActions.includes("edit_script_settings");
  const mediaEditable = project.allowedActions.includes("edit_media_settings");
  const anyEditable = scriptEditable || mediaEditable;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    const current = settingsOf(project);
    const changes = Object.fromEntries(SETTING_KEYS.filter((k) => draft[k] !== current[k]).map((k) => [k, draft[k]])) as Partial<Settings>;
    if (!Object.keys(changes).length) {
      setEditing(false);
      return;
    }
    setMessage(null);
    start(async () => {
      try {
        const { project: next, requiresRegeneration } = await patchProject<Project>(project, changes);
        onSaved(next);
        setDraft(settingsOf(next));
        setEditing(false);
        // "Regenerate" / "rebuild" stay true until the video moves to another stage, so they stay on screen through
        // unrelated saves (a rename); a plain "Saved." is about this save only.
        if (requiresRegeneration) {
          setMessage({ value: { tone: "info", text: "Saved. Regenerate the storyboard to use the new settings." }, rev: next.rev, status: next.status });
        } else if (next.exportOutdated && !project.exportOutdated) {
          setMessage({ value: { tone: "info", text: "Saved. Rebuild or re-export the video to apply it." }, rev: next.rev, status: next.status });
        } else {
          setMessage({ value: { tone: "info", text: "Saved." }, rev: next.rev });
        }
      } catch (err) {
        const latest = conflictCopy<Project>(err);
        if (latest) {
          onSaved(latest);
          setDraft(settingsOf(latest));
          setMessage({ value: { tone: "error", text: "This video was changed in another tab. We loaded the latest settings — check them and save again." }, rev: latest.rev });
        } else {
          setMessage({ value: { tone: "error", text: err instanceof ApiClientError ? err.message : "Couldn't save the settings. Please try again." }, rev: project.rev });
        }
      }
    });
  };

  const rows: { label: string; view: string; edit: React.ReactNode; editable: boolean }[] = [
    {
      label: "Language",
      view: labelOf(LANGUAGE_OPTIONS, project.language),
      editable: scriptEditable,
      edit: (
        <Select aria-label="Language" value={draft.language} disabled={!scriptEditable} onChange={(e) => set("language", e.target.value as Settings["language"])}>
          {LANGUAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: "Length",
      view: labelOf(LENGTH_OPTIONS, project.lengthPreset),
      editable: scriptEditable,
      edit: (
        <Select aria-label="Length" value={draft.lengthPreset} disabled={!scriptEditable} onChange={(e) => set("lengthPreset", Number(e.target.value) as 60 | 90)}>
          {LENGTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: "Audience",
      view: labelOf(AUDIENCE_OPTIONS, project.audience as (typeof AUDIENCE_OPTIONS)[number]["value"]),
      editable: scriptEditable,
      edit: (
        <Select aria-label="Audience" value={draft.audience} disabled={!scriptEditable} onChange={(e) => set("audience", e.target.value)}>
          {AUDIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: "Board / exam",
      view: labelOf(BOARD_OPTIONS, project.boardOrExam as (typeof BOARD_OPTIONS)[number]["value"]),
      editable: scriptEditable,
      edit: (
        <Select
          aria-label="Board or exam"
          value={draft.boardOrExam ?? ""}
          disabled={!scriptEditable}
          onChange={(e) => set("boardOrExam", (e.target.value || null) as Settings["boardOrExam"])}
        >
          {BOARD_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: "Voice",
      view: labelOf(VOICE_OPTIONS, project.voiceGender),
      editable: mediaEditable,
      edit: (
        <Select aria-label="Voice" value={draft.voiceGender} disabled={!mediaEditable} onChange={(e) => set("voiceGender", e.target.value as Settings["voiceGender"])}>
          {VOICE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      label: "Captions",
      view: project.captionsEnabled ? "On" : "Off",
      editable: mediaEditable,
      edit: (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.captionsEnabled} disabled={!mediaEditable} onChange={(e) => set("captionsEnabled", e.target.checked)} />
          Show captions
        </label>
      ),
    },
  ];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <Eyebrow>settings</Eyebrow>
      <dl className="flex flex-col divide-y divide-line text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">{r.label}</dt>
            <dd className={cx("text-right", editing && "w-44")}>{editing ? r.edit : r.view}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-muted">Style</dt>
          <dd>{STYLE_LABELS[project.styleId] ?? project.styleId}</dd>
        </div>
      </dl>

      {editing ? (
        <>
          <p className="text-xs text-dim">
            {!scriptEditable ? "Language, length, audience and board can't change once the video is built — duplicate it to try different ones. " : ""}
            {!mediaEditable ? "Voice and captions can be chosen once the storyboard is ready." : ""}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={pending} className="flex-1">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraft(settingsOf(project));
                setEditing(false);
                setMessage(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="font-mono"
          disabled={!anyEditable}
          title={anyEditable ? undefined : "Settings can't change at this stage of the video"}
          onClick={() => {
            setDraft(settingsOf(project));
            setMessage(null);
            setEditing(true);
          }}
        >
          {"// edit parameters"}
        </Button>
      )}

      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cx("text-sm", message.tone === "error" ? "text-red" : "text-cyan")}>
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}
