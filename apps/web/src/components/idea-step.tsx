"use client";

import { NOTES_PROBLEM_TEXT, notesLanguage, notesProblem } from "@videozilla/ai/notes";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import type { AutosaveState } from "@/lib/autosave";
import { clampChars, stripControlChars } from "@/lib/project-client";
import { AUDIENCE_OPTIONS } from "@/lib/project-options";
import { useAutosave } from "@/lib/use-autosave";
import type { IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { Button, Card, Eyebrow, cx, inputStyles } from "./ui";

type Idea = IdeaSessionResource;
type Mode = Idea["mode"];
type Draft = Pick<Idea, "mode" | "topicInput" | "ideaInput" | "notesText">;
type Suggestion = Idea["suggestions"][number];
type Brief = NonNullable<Idea["brief"]>;
/** `POST …/idea/brief` (F2.3). */
type BriefReply = { brief: Brief; alternatives: Brief[]; briefUpdatedAt: string | null; project: ProjectResource };

/** Same limits as the API and the database (characters, so an emoji or a Hindi letter is one). */
const LIMITS = { topicInput: 200, ideaInput: 500, notesText: 20_000 } as const;
/** The server keeps the newest 30 cards; "avoid these titles" sends at most 30 of up to 120 characters. */
const MAX_CARDS = 30;

const TABS: { mode: Mode; label: string; field: keyof typeof LIMITS }[] = [
  { mode: "topic", label: "Find a topic", field: "topicInput" },
  { mode: "idea", label: "I have an idea", field: "ideaInput" },
  { mode: "notes", label: "Use my notes", field: "notesText" },
];

const LANGUAGE_NAME = { en: "English", hi: "Hindi", other: "another language" } as const;

const draftOf = (i: Idea): Draft => ({ mode: i.mode, topicInput: i.topicInput, ideaInput: i.ideaInput, notesText: i.notesText });
const count = (s: string) => Array.from(s).length;

/**
 * The Idea step (PRD F2): three ways to start, each with its own text, autosaved through
 * `PUT /api/v1/projects/{id}/idea` (F2.1). "Find a topic" asks Gemini for 5 idea cards (F2.2); "Use this" on a card
 * or "Sharpen my idea" makes the brief, with 2 other angles (F2.3); "Turn my notes into a brief" does the same from the
 * pasted notes (F2.4). F2.7 restyles this as Stitch screen 09. `onProject` gets the project after a brief, whose title may have followed it (PRD F2-FR11).
 */
export function IdeaStep(props: { projectId: string; language: ProjectResource["language"]; initial: Idea; editable: boolean; onProject: (p: ProjectResource) => void }) {
  const { projectId, language, initial, editable, onProject } = props;
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [clipped, setClipped] = useState<keyof typeof LIMITS | null>(null);
  const [brief, setBrief] = useState<{ brief: Brief | null; alternatives: Brief[]; updatedAt: string | null }>({
    brief: initial.brief,
    alternatives: initial.briefAlternatives,
    updatedAt: initial.briefUpdatedAt,
  });
  const ai = useIdeaAi();
  const suggestButton = useRef<HTMLButtonElement>(null);
  const { state, queue } = useAutosave<Draft, Idea>({
    rev: initial.rev,
    save: async (value, rev, { keepalive }) =>
      (await apiCall<Idea>(`/api/v1/projects/${projectId}/idea`, { method: "PUT", body: value, headers: { "If-Match": `"${rev}"` }, keepalive })).data,
  });

  const update = (next: Draft) => {
    setDraft(next);
    queue.change(next);
  };

  /** Asks for a brief (or switches angle) and shows it. `before` may stop the request with a message. */
  const makeBrief = (kind: string, request: Record<string, unknown>, before?: () => Promise<string | null>) =>
    ai.run(kind, async () => {
      const problem = await before?.();
      if (problem) throw new Error(problem);
      const { data } = await apiCall<BriefReply>(`/api/v1/projects/${projectId}/idea/brief`, { method: "POST", body: request });
      setBrief({ brief: data.brief, alternatives: data.alternatives, updatedAt: data.briefUpdatedAt });
      onProject(data.project);
    });

  // The server makes the brief from the saved idea text, so whatever is still being typed is saved first.
  const sharpen = () =>
    makeBrief("sharpen", { from: "idea" }, async () =>
      (await queue.settle()) ? null : "Your idea isn't saved yet, so it can't be sharpened. Check the save status above and try again.",
    );

  // Same: the brief comes from the saved notes.
  const fromNotes = () =>
    makeBrief("notes", { from: "notes" }, async () =>
      (await queue.settle()) ? null : "Your notes aren't saved yet, so no brief can be made. Check the save status above and try again.",
    );

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
  const ideaText = draft.ideaInput.trim();
  // The same checks as the server, so the button says why before anything is sent.
  const notesIssue = notesProblem(draft.notesText);
  const notesLang = notesLanguage(draft.notesText);

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
            onClick={() => {
              if (t.mode === draft.mode) return;
              ai.clearError(); // an error belongs to the tab it came from
              update({ ...draft, mode: t.mode });
            }}
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
            // Enter asks for ideas, like pressing "Suggest 5 ideas" (a no-op while that button is disabled).
            onEnter={() => suggestButton.current?.click()}
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
          <TopicIdeas
            projectId={projectId}
            topic={draft.topicInput}
            initial={initial.suggestions}
            editable={editable}
            ai={ai}
            suggestButton={suggestButton}
            onUse={(card) => makeBrief(`use:${card.id}`, { from: "suggestion", suggestionId: card.id })}
          />
        ) : tab.mode === "idea" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={!editable || !ai.canAsk || !ideaText} onClick={sharpen} aria-busy={ai.busy === "sharpen"}>
                {ai.busy === "sharpen" ? "Thinking…" : brief.brief ? "Sharpen again" : "Sharpen my idea"}
              </Button>
              {!ideaText && editable ? <span className="text-xs text-muted">Describe your idea first.</span> : null}
              {ideaText && brief.brief && editable && !ai.busy ? <span className="text-xs text-muted">A new brief replaces the one below.</span> : null}
              <Thinking busy={ai.busy} />
            </div>
            <AiError error={ai.error} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {notesLang && notesLang !== language ? (
              <p className="text-sm text-muted">
                Your notes are in {LANGUAGE_NAME[notesLang]}; the video will be in {LANGUAGE_NAME[language]}.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={!editable || !ai.canAsk || notesIssue !== null} onClick={fromNotes} aria-busy={ai.busy === "notes"}>
                {ai.busy === "notes" ? "Thinking…" : brief.brief ? "Make a new brief from my notes" : "Turn my notes into a brief"}
              </Button>
              {notesIssue && editable ? <span className="text-xs text-muted">{NOTES_PROBLEM_TEXT[notesIssue]}</span> : null}
              {!notesIssue && brief.brief && editable && !ai.busy ? <span className="text-xs text-muted">A new brief replaces the one below.</span> : null}
              <Thinking busy={ai.busy} />
            </div>
            <AiError error={ai.error} />
          </div>
        )}
      </div>

      {brief.brief ? (
        <BriefCard
          brief={brief.brief}
          alternatives={brief.alternatives}
          editable={editable}
          ai={ai}
          // The brief being looked at: a repeated or retried switch then can't swap back (the server keeps the current one).
          onSwitch={(index) => makeBrief(`angle:${index}`, { from: "alternative", index, ...(brief.updatedAt && { briefUpdatedAt: brief.updatedAt }) })}
        />
      ) : null}
    </Card>
  );
}

type IdeaAi = ReturnType<typeof useIdeaAi>;
type AiErrorState = { message: string; reason?: string; code?: string } | null;

/**
 * The Idea step's AI requests (suggestions and briefs) run one at a time: each costs a Gemini call and a unit of the
 * shared daily `ideas` limit, so a second click before the re-render must not send another. After `429 LIMIT_REACHED`
 * — or on load, when `GET /me/usage` says today's ideas are used up — asking stays off until the limit resets.
 */
function useIdeaAi() {
  const [busy, setBusy] = useState<string | null>(null); // which request: "new", "more", a card id, "use:…", "sharpen", "angle:…"
  // The error to show; `reason` is our own sentence for why a topic was refused (422 UNSAFE_CONTENT), never the AI's
  // text; `code` lets the 429 message go away when the limit resets.
  const [error, setError] = useState<AiErrorState>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const asking = useRef(false);

  // Seed the lock from today's usage, so a reload doesn't turn the buttons back on after the limit.
  useEffect(() => {
    let cancelled = false;
    apiCall<{ resetsAt: string; counters: { ideas?: { used: number; limit: number } } }>("/api/v1/me/usage")
      .then(({ data }) => {
        const ideas = data.counters.ideas;
        const resetsAt = Date.parse(data.resetsAt);
        if (cancelled || !ideas || ideas.used < ideas.limit || !Number.isFinite(resetsAt)) return;
        setLockedUntil((t) => t ?? resetsAt);
        // Say why the buttons are off, as a 429 would.
        setError((e) => e ?? { message: "You've reached today's limit for AI idea requests. It resets at midnight (IST).", code: "LIMIT_REACHED" });
      })
      .catch(() => {}); // only a hint: the API still answers 429 when the limit is reached
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedUntil === null) return;
    // Long waits are re-checked at least hourly: a laptop may sleep through a single long timer.
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const left = lockedUntil - Date.now();
      if (left <= 0) {
        setLockedUntil(null);
        setError((e) => (e?.code === "LIMIT_REACHED" ? null : e)); // the limit has reset: don't keep saying it's reached
      } else timer = setTimeout(check, Math.min(left, 3_600_000));
    };
    timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  const run = useCallback(async (kind: string, fn: () => Promise<void>) => {
    if (asking.current) return;
    asking.current = true;
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof ApiClientError)) {
        setError({ message: err instanceof Error && err.message ? err.message : "Something went wrong. Please try again." });
      } else {
        const issue = err.details[0]?.issue;
        setError({ message: err.message, code: err.code, reason: err.code === "UNSAFE_CONTENT" && typeof issue === "string" ? issue : undefined });
        const resetsAt = err.code === "LIMIT_REACHED" ? Date.parse(String(err.details[0]?.resetsAt ?? "")) : NaN;
        if (Number.isFinite(resetsAt)) setLockedUntil(resetsAt);
      }
    } finally {
      asking.current = false;
      setBusy(null);
    }
  }, []);

  // The "limit reached" message stays with the lock, whichever tab is open.
  const clearError = useCallback(() => setError((e) => (e?.code === "LIMIT_REACHED" ? e : null)), []);
  // `canAsk`: an AI request may go out. `idle`: nothing is running (switching angle needs no AI and isn't counted).
  return { busy, error, run, clearError, idle: busy === null, canAsk: busy === null && lockedUntil === null };
}

function Thinking({ busy }: { busy: string | null }) {
  // Switching angle makes no AI call.
  if (!busy || busy.startsWith("angle:")) return null;
  return (
    <span role="status" className="font-mono text-xs text-violet">
      {busy === "notes" ? "// the AI is reading your notes — up to 25 seconds" : "// the AI is thinking — usually about 10 seconds"}
    </span>
  );
}

function AiError({ error }: { error: AiErrorState }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl border border-red/40 bg-red/5 px-4 py-3 text-sm">
      <p>{error.message}</p>
      {error.reason ? <p className="text-muted">{error.reason}</p> : null}
    </div>
  );
}

/**
 * "Find a topic" (F2.2): asks for 5 idea cards (`POST …/idea/suggestions`), then "Suggest 5 more" or "More like this"
 * without repeating titles already shown. Cards are saved with the video, newest first here. "Use this" makes a card
 * the brief (F2.3).
 */
function TopicIdeas(props: {
  projectId: string;
  topic: string;
  initial: Suggestion[];
  editable: boolean;
  ai: IdeaAi;
  suggestButton: React.RefObject<HTMLButtonElement | null>;
  onUse: (card: Suggestion) => void;
}) {
  const { projectId, topic, initial, editable, ai, suggestButton, onUse } = props;
  const [cards, setCards] = useState<Suggestion[]>(initial);
  const trimmed = topic.trim();
  const busy = ai.busy;

  const ask = (kind: string, askTopic: string, avoid: Suggestion[]) =>
    ai.run(kind, async () => {
      const { data } = await apiCall<{ suggestions: Suggestion[] }>(`/api/v1/projects/${projectId}/idea/suggestions`, {
        method: "POST",
        body: { topic: clampChars(askTopic, LIMITS.topicInput), ...(avoid.length && { avoidTitles: avoid.slice(-MAX_CARDS).map((c) => clampChars(c.title, 120)) }) },
      });
      setCards((prev) => [...prev, ...data.suggestions].slice(-MAX_CARDS));
    });

  const newestFirst = [...cards].reverse();
  const canAsk = editable && ai.canAsk;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={suggestButton} type="button" disabled={!canAsk || !trimmed} onClick={() => ask("new", trimmed, cards)} aria-busy={busy === "new"}>
          {busy === "new" ? "Thinking…" : "Suggest 5 ideas"}
        </Button>
        {!trimmed && editable ? <span className="text-xs text-muted">Type a subject first.</span> : null}
        <Thinking busy={busy} />
      </div>

      <AiError error={ai.error} />

      {cards.length ? (
        <>
          {/* Visible, not only a tooltip: phones can't hover. */}
          <p className="text-xs text-muted">“Use this” turns an idea into the brief for your video.</p>
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
                  <Button type="button" disabled={!canAsk} onClick={() => onUse(c)} aria-busy={busy === `use:${c.id}`}>
                    {busy === `use:${c.id}` ? "Thinking…" : "Use this"}
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

/**
 * The brief (F2.3): what the video will be, and 2 other angles to switch to. The current brief takes the chosen angle's
 * place, so switching back is one click. "Generate storyboard" arrives with the storyboard milestone (F3).
 */
function BriefCard(props: { brief: Brief; alternatives: Brief[]; editable: boolean; ai: IdeaAi; onSwitch: (index: number) => void }) {
  const { brief, alternatives, editable, ai, onSwitch } = props;
  const audience = AUDIENCE_OPTIONS.find((o) => o.value === brief.audience)?.label ?? brief.audience;
  return (
    // A container query: the card is narrow beside the settings panel even on a wide screen.
    <section aria-labelledby="brief-title" className="@container flex flex-col gap-5 rounded-xl border border-cyan/40 bg-cyan/5 p-5">
      <div className="flex flex-col gap-2">
        <Eyebrow>your brief</Eyebrow>
        <h3 id="brief-title" className="text-xl font-semibold leading-snug">
          {brief.title}
        </h3>
        <p className="text-cyan">“{brief.hook}”</p>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm [&>dd]:mb-2 @md:grid-cols-[7rem_1fr] @md:gap-y-3 @md:[&>dd]:mb-0">
        <dt className="text-muted">Angle</dt>
        <dd>{brief.angle}</dd>
        <dt className="text-muted">Audience</dt>
        <dd>{audience}</dd>
        {brief.sourceNotesSummary ? (
          <>
            <dt className="text-muted">From your notes</dt>
            <dd>{brief.sourceNotesSummary}</dd>
          </>
        ) : null}
        <dt className="text-muted">Key points</dt>
        <dd>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {brief.keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ol>
        </dd>
        {brief.outOfScope.length ? (
          <>
            <dt className="text-muted">Left out to fit the length</dt>
            <dd>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
                {brief.outOfScope.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>

      {alternatives.length ? (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-medium text-muted">Other angles</h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3" aria-label="Other angles">
            {alternatives.map((a, i) => (
              <li key={`${i}-${a.title}`} className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-4">
                <p className="font-medium leading-snug">{a.title}</p>
                <p className="text-sm text-muted">{a.angle}</p>
                <div className="mt-auto pt-1">
                  <Button type="button" variant="secondary" disabled={!editable || !ai.idle} onClick={() => onSwitch(i)} aria-busy={ai.busy === `angle:${i}`}>
                    {ai.busy === `angle:${i}` ? "Switching…" : "Use this angle"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button type="button" disabled title="Arrives with the storyboard (next milestone)">
          Generate storyboard
        </Button>
        <span className="font-mono text-xs text-muted">{"// next milestone"}</span>
      </div>
    </section>
  );
}

function TextBox(props: { label: string; hint: string; value: string; max: number; rows?: number; readOnly: boolean; onChange: (v: string) => void; onEnter?: () => void }) {
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
      {props.rows ? (
        <textarea rows={props.rows} {...common} />
      ) : (
        <input
          type="text"
          {...common}
          onKeyDown={(e) => {
            // Not while an input method (Hindi typing) is composing: its Enter picks a word.
            if (e.key === "Enter" && !e.nativeEvent.isComposing && props.onEnter) {
              e.preventDefault();
              props.onEnter();
            }
          }}
        />
      )}
      {/* Muted, not dim: small text needs 4.5:1 contrast (dim is about 3:1 on this background). */}
      <div className="flex justify-between gap-3 text-xs text-muted">
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
