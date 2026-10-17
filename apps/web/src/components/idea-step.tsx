"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import type { AutosaveState } from "@/lib/autosave";
import { clampChars, stripControlChars } from "@/lib/project-client";
import { useAutosave } from "@/lib/use-autosave";
import type { IdeaSessionResource } from "@/server/api/resources";
import { Button, Card, Eyebrow, cx, inputStyles } from "./ui";

type Idea = IdeaSessionResource;
type Mode = Idea["mode"];
type Draft = Pick<Idea, "mode" | "topicInput" | "ideaInput" | "notesText">;
type Suggestion = Idea["suggestions"][number];

/** Same limits as the API and the database (characters, so an emoji or a Hindi letter is one). */
const LIMITS = { topicInput: 200, ideaInput: 500, notesText: 20_000 } as const;
/** The server keeps the newest 30 cards; "avoid these titles" sends at most 30 of up to 120 characters. */
const MAX_CARDS = 30;

const TABS: { mode: Mode; label: string; field: keyof typeof LIMITS }[] = [
  { mode: "topic", label: "Find a topic", field: "topicInput" },
  { mode: "idea", label: "I have an idea", field: "ideaInput" },
  { mode: "notes", label: "Use my notes", field: "notesText" },
];

const draftOf = (i: Idea): Draft => ({ mode: i.mode, topicInput: i.topicInput, ideaInput: i.ideaInput, notesText: i.notesText });
const count = (s: string) => Array.from(s).length;

/**
 * The Idea step (PRD F2): three ways to start, each with its own text, autosaved through
 * `PUT /api/v1/projects/{id}/idea` (F2.1). "Find a topic" asks Gemini for 5 idea cards (F2.2). Briefs (F2.3) and
 * notes (F2.4) come next; F2.7 restyles this as Stitch screen 09.
 */
export function IdeaStep({ projectId, initial, editable }: { projectId: string; initial: Idea; editable: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [clipped, setClipped] = useState<keyof typeof LIMITS | null>(null);
  const { state, queue } = useAutosave<Draft, Idea>({
    rev: initial.rev,
    save: async (value, rev, { keepalive }) =>
      (await apiCall<Idea>(`/api/v1/projects/${projectId}/idea`, { method: "PUT", body: value, headers: { "If-Match": `"${rev}"` }, keepalive })).data,
  });

  const update = (next: Draft) => {
    setDraft(next);
    queue.change(next);
  };

  const setText = (field: keyof typeof LIMITS, raw: string) => {
    // Pasted notes often carry invisible control characters (page breaks from PDFs), which the API rejects; drop them
    // here so the text can always be saved.
    const clean = stripControlChars(raw);
    const value = clampChars(clean, LIMITS[field]);
    setClipped(value.length < clean.length ? field : null);
    update({ ...draft, [field]: value });
  };

  const tab = TABS.find((t) => t.mode === draft.mode) ?? TABS[0];
  const conflict = state.status === "conflict" ? state.conflict : undefined;

  return (
    <Card className="flex min-h-80 flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow accent="text-violet">idea studio</Eyebrow>
        <SaveStatus state={state} />
      </div>

      <div role="tablist" aria-label="How do you want to start?" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-raised p-1">
        {TABS.map((t) => (
          <button
            key={t.mode}
            type="button"
            role="tab"
            id={`idea-tab-${t.mode}`}
            aria-selected={t.mode === draft.mode}
            aria-controls="idea-panel"
            disabled={!editable}
            onClick={() => t.mode !== draft.mode && update({ ...draft, mode: t.mode })}
            className={cx(
              "rounded-lg px-2 py-2 text-sm transition-colors",
              t.mode === draft.mode ? "bg-surface font-medium text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Above the text box, so it's in view on a phone too. */}
      {conflict ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-orange/40 bg-orange/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">This idea was changed in another tab. Your latest typing isn&apos;t saved yet.</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const latest = draftOf(conflict);
                setDraft(latest);
                queue.loadLatest(latest, conflict.rev);
              }}
            >
              Load latest
            </Button>
            <Button type="button" onClick={() => queue.keepMine()}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === "error" && state.stopped ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red/40 bg-red/5 px-4 py-3">
          <span className="text-sm">{state.error}</span>
          {/* A full reload: this editor and its stopped autosave are local state that a refresh would keep. */}
          <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : null}

      <div role="tabpanel" id="idea-panel" aria-labelledby={`idea-tab-${tab.mode}`} className="flex flex-col gap-3">
        {tab.mode === "topic" ? (
          <TextBox
            label="What subject or niche?"
            hint="For example: photosynthesis for Class 7, or personal finance basics. The AI will suggest 5 video ideas."
            value={draft.topicInput}
            max={LIMITS.topicInput}
            onChange={(v) => setText("topicInput", v)}
            readOnly={!editable}
          />
        ) : tab.mode === "idea" ? (
          <TextBox
            label="Describe your idea"
            hint="A sentence or two is enough. The AI will sharpen it into a brief and suggest 2 other angles."
            value={draft.ideaInput}
            max={LIMITS.ideaInput}
            rows={4}
            onChange={(v) => setText("ideaInput", v)}
            readOnly={!editable}
          />
        ) : (
          <TextBox
            label="Paste your notes"
            hint="Any language. The AI will pick one focus that fits 60–90 seconds and say what it leaves out."
            value={draft.notesText}
            max={LIMITS.notesText}
            rows={12}
            onChange={(v) => setText("notesText", v)}
            readOnly={!editable}
          />
        )}
        {clipped === tab.field ? (
          <p role="status" className="text-sm text-orange">
            That was longer than {LIMITS[tab.field].toLocaleString("en-IN")} characters, so the end was cut off.
          </p>
        ) : null}

        {tab.mode === "topic" ? (
          <TopicIdeas projectId={projectId} topic={draft.topicInput} initial={initial.suggestions} editable={editable} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled title="Arrives in a later update">
              {tab.mode === "idea" ? "Sharpen my idea" : "Turn my notes into a brief"}
            </Button>
            <span className="font-mono text-xs text-dim">{"// arrives in a later update"}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * "Find a topic" (F2.2): asks for 5 idea cards (`POST …/idea/suggestions`), then "Suggest 5 more" or "More like this"
 * without repeating titles already shown. Cards are saved with the video, newest first here.
 */
function TopicIdeas({ projectId, topic, initial, editable }: { projectId: string; topic: string; initial: Suggestion[]; editable: boolean }) {
  const [cards, setCards] = useState<Suggestion[]>(initial);
  const [busy, setBusy] = useState<"new" | "more" | string | null>(null); // "new", "more" or the card id for "more like this"
  // The error to show; `reason` is the AI's own explanation of a refusal (422 UNSAFE_CONTENT).
  const [error, setError] = useState<{ message: string; reason?: string } | null>(null);
  // After 429 LIMIT_REACHED: asking stays off until the daily limit resets (the button would only fail again).
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  useEffect(() => {
    if (lockedUntil === null) return;
    // Long waits are re-checked at least hourly: a laptop may sleep through a single long timer.
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const left = lockedUntil - Date.now();
      if (left <= 0) setLockedUntil(null);
      else timer = setTimeout(check, Math.min(left, 3_600_000));
    };
    timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, [lockedUntil]);
  const trimmed = topic.trim();

  // Each request costs a Gemini call and a unit of the daily limit: a second click before the re-render must not send
  // another.
  const asking = useRef(false);

  const ask = async (kind: string, askTopic: string, avoid: Suggestion[]) => {
    if (asking.current) return;
    asking.current = true;
    setBusy(kind);
    setError(null);
    try {
      const { data } = await apiCall<{ suggestions: Suggestion[] }>(`/api/v1/projects/${projectId}/idea/suggestions`, {
        method: "POST",
        body: { topic: clampChars(askTopic, LIMITS.topicInput), ...(avoid.length && { avoidTitles: avoid.slice(-MAX_CARDS).map((c) => clampChars(c.title, 120)) }) },
      });
      setCards((prev) => [...prev, ...data.suggestions].slice(-MAX_CARDS));
    } catch (err) {
      if (!(err instanceof ApiClientError)) {
        setError({ message: "Couldn't get ideas. Please try again." });
      } else {
        const issue = err.details[0]?.issue;
        setError({ message: err.message, reason: err.code === "UNSAFE_CONTENT" && typeof issue === "string" ? issue : undefined });
        const resetsAt = err.code === "LIMIT_REACHED" ? Date.parse(String(err.details[0]?.resetsAt ?? "")) : NaN;
        if (Number.isFinite(resetsAt)) setLockedUntil(resetsAt);
      }
    } finally {
      asking.current = false;
      setBusy(null);
    }
  };

  const newestFirst = [...cards].reverse();
  const canAsk = editable && busy === null && lockedUntil === null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!canAsk || !trimmed} onClick={() => ask("new", trimmed, cards)} aria-busy={busy === "new"}>
          {busy === "new" ? "Thinking…" : "Suggest 5 ideas"}
        </Button>
        {!trimmed && editable ? <span className="text-xs text-dim">Type a subject first.</span> : null}
        {busy ? (
          <span role="status" className="font-mono text-xs text-violet">
            {"// gemini is thinking — usually about 10 seconds"}
          </span>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-red/40 bg-red/5 px-4 py-3 text-sm">
          <p>{error.message}</p>
          {error.reason ? <p className="text-muted">{error.reason}</p> : null}
        </div>
      ) : null}

      {cards.length ? (
        <>
          {/* Visible, not only a tooltip: phones can't hover. */}
          <p className="text-xs text-dim">“Use this” turns an idea into a brief for your video. It arrives in the next update.</p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3" aria-label="Video ideas">
            {newestFirst.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold leading-snug">{c.title}</h3>
                  <p className="text-sm text-cyan">“{c.hook}”</p>
                </div>
                <p className="text-sm text-muted">{c.angle}</p>
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                  {c.keyPoints.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ol>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Button type="button" disabled title="Turning an idea into a brief arrives in the next update (F2.3)">
                    Use this
                  </Button>
                  <Button type="button" variant="secondary" disabled={!canAsk} onClick={() => ask(c.id, c.title, cards)} aria-busy={busy === c.id}>
                    {busy === c.id ? "Thinking…" : "More like this"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div>
            <Button type="button" variant="secondary" disabled={!canAsk || !trimmed} onClick={() => ask("more", trimmed, cards)} aria-busy={busy === "more"}>
              {busy === "more" ? "Thinking…" : "Suggest 5 more"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TextBox(props: { label: string; hint: string; value: string; max: number; rows?: number; readOnly: boolean; onChange: (v: string) => void }) {
  const id = useId();
  const used = count(props.value);
  const common = {
    id,
    value: props.value,
    readOnly: props.readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.onChange(e.target.value),
    className: cx(inputStyles, props.rows !== undefined && "resize-y leading-relaxed"),
    // The label is the name; the hint and the counter are its description.
    "aria-describedby": `${id}-hint ${id}-count`,
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {props.label}
      </label>
      {props.rows ? <textarea rows={props.rows} {...common} /> : <input type="text" {...common} />}
      <div className="flex justify-between gap-3 text-xs text-dim">
        <span id={`${id}-hint`}>{props.hint}</span>
        <span id={`${id}-count`} className={cx("shrink-0 font-mono", used >= props.max && "text-orange")}>
          {used.toLocaleString("en-IN")} / {props.max.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline — will save when reconnected",
  conflict: "Not saved — changed in another tab",
};

function SaveStatus({ state }: { state: AutosaveState<Idea> }) {
  const text = state.status === "error" ? (state.stopped ? "Not saved" : `Not saved — ${state.error ?? "trying again"}`) : STATUS_TEXT[state.status];
  if (!text) return null;
  const tone = state.status === "saved" ? "text-cyan" : state.status === "pending" || state.status === "saving" ? "text-muted" : "text-orange";
  return (
    <span role="status" aria-live="polite" className={cx("font-mono text-xs", tone)}>
      {text}
    </span>
  );
}
