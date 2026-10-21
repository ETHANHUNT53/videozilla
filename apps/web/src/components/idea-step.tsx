"use client";

import { NOTES_PROBLEM_TEXT, notesLanguage, notesProblem } from "@videozilla/ai/notes";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import type { AutosaveState } from "@/lib/autosave";
import { clampChars, stripControlChars } from "@/lib/project-client";
import { briefSettingsChange } from "@/lib/brief-settings";
import { AUDIENCE_OPTIONS } from "@/lib/project-options";
import { useAutosave } from "@/lib/use-autosave";
import type { ChatMessageResource, IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { BriefEditor } from "./brief-editor";
import { IdeaChat } from "./idea-chat";
import { GenerateCard, type StoryboardRun } from "./storyboard-run";
import { Button, Card, Eyebrow, Slashes, cx, inputStyles } from "./ui";

type Idea = IdeaSessionResource;
type Mode = Idea["mode"];
type Draft = Pick<Idea, "mode" | "topicInput" | "ideaInput" | "notesText">;
type Suggestion = Idea["suggestions"][number];
type Brief = NonNullable<Idea["brief"]>;
/** `POST …/idea/brief` (F2.3). */
type BriefReply = {
  brief: Brief;
  alternatives: Brief[];
  briefUpdatedAt: string | null;
  briefLanguage: Idea["briefLanguage"];
  briefLengthSec: Idea["briefLengthSec"];
  briefCardId: string | null;
  project: ProjectResource;
};
/** What the brief was written for (F2.6 follow-up); null for briefs from before it. */
type WrittenFor = { language: Idea["briefLanguage"]; lengthSec: Idea["briefLengthSec"] };
/** The brief as the page shows it; `cardId`: the idea card it came from (F2.7, marked Selected). */
type BriefState = { brief: Brief | null; alternatives: Brief[]; updatedAt: string | null; writtenFor: WrittenFor; cardId: string | null };

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
 * pasted notes (F2.4); chat refines it (F2.5) and Edit changes it directly (F2.8). F2.7 lays it out as Stitch screen 09:
 * the ideas on the left; the brief with its chat, the settings and "Generate storyboard" on the right. `onProject` gets
 * the project after a brief, whose title may have followed it (PRD F2-FR11).
 */
export function IdeaStep(props: {
  projectId: string;
  language: ProjectResource["language"];
  lengthSec: ProjectResource["lengthPreset"];
  initial: Idea;
  initialChat: { items: ChatMessageResource[]; hasOlder: boolean };
  editable: boolean;
  onProject: (p: ProjectResource) => void;
  /** The settings panel, placed in the right column under the brief (Stitch 09). */
  settings: React.ReactNode;
  /** The video's status, for Generate / Regenerate storyboard (F3.1). */
  status: ProjectResource["status"];
  /** Starting and following the storyboard generation (F3.1). */
  storyboard: StoryboardRun;
}) {
  const { projectId, language, lengthSec, initial, initialChat, editable, onProject, settings, status, storyboard } = props;
  // Brief fields the last chat answer changed (F2.5), highlighted until the next message or a new brief.
  const [changed, setChanged] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [clipped, setClipped] = useState<keyof typeof LIMITS | null>(null);
  const [brief, setBrief] = useState<BriefState>(() => briefStateOf(initial));
  // "Keep as is" hides the bar for these settings until the next reload (your answer, F2.6 follow-up).
  const [keptFor, setKeptFor] = useState<string | null>(null);
  const aiRunner = useIdeaAi();
  // While the brief is being edited (F2.8), the AI requests that would replace it (chat, Use this angle, Regenerate, a
  // new brief) are paused, so the typing isn't replaced underneath; they come back on Save or Cancel.
  const [editingBrief, setEditingBrief] = useState(false);
  const ai = editingBrief ? { ...aiRunner, canAsk: false, idle: false } : aiRunner;
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
      setBrief(briefStateOf(data));
      setChanged([]);
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
    // Stitch 09 (F2.7): the ideas get the wide column; the brief you're shaping, its chat, the settings and "Generate
    // storyboard" stay in view on the right. One column below lg, in the same order.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <Card className="flex min-h-80 min-w-0 flex-col gap-5 p-6">
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
                t.mode === draft.mode ? "bg-cyan/10 font-medium text-fg ring-1 ring-cyan/40" : "text-muted hover:text-fg",
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
            <TopicIdeas
              projectId={projectId}
              topic={draft.topicInput}
              onTopic={(v) => setText("topicInput", v)}
              clipped={clipped === "topicInput"}
              initial={initial.suggestions}
              selectedId={brief.brief ? brief.cardId : null}
              editable={editable}
              ai={ai}
              onUse={(card) => makeBrief(`use:${card.id}`, { from: "suggestion", suggestionId: card.id })}
            />
          ) : tab.mode === "idea" ? (
            <>
              <TextBox
                label="Describe your idea"
                hint="A sentence or two is enough. The AI will sharpen it into a brief and suggest 2 other angles."
                value={draft.ideaInput}
                max={LIMITS.ideaInput}
                rows={4}
                onChange={(v) => setText("ideaInput", v)}
                readOnly={!editable}
              />
              <Clipped show={clipped === "ideaInput"} max={LIMITS.ideaInput} />
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" disabled={!editable || !ai.canAsk || !ideaText} onClick={sharpen} aria-busy={ai.busy === "sharpen"}>
                    {ai.busy === "sharpen" ? "Thinking…" : brief.brief ? "Sharpen again" : "Sharpen my idea"}
                  </Button>
                  {!ideaText && editable ? <span className="text-xs text-muted">Describe your idea first.</span> : null}
                  {ideaText && brief.brief && editable && !ai.busy ? <span className="text-xs text-muted">A new brief replaces the current one.</span> : null}
                  <Thinking busy={ai.busy} />
                </div>
                <AiError error={ai.error} />
              </div>
            </>
          ) : (
            <>
              <TextBox
                label="Paste your notes"
                hint="Any language. The AI will pick one focus that fits 60–90 seconds and say what it leaves out."
                value={draft.notesText}
                max={LIMITS.notesText}
                rows={12}
                onChange={(v) => setText("notesText", v)}
                readOnly={!editable}
              />
              <Clipped show={clipped === "notesText"} max={LIMITS.notesText} />
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
                  {!notesIssue && brief.brief && editable && !ai.busy ? <span className="text-xs text-muted">A new brief replaces the current one.</span> : null}
                  <Thinking busy={ai.busy} />
                </div>
                <AiError error={ai.error} />
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-6">
        {brief.brief && editable ? (
          <SettingsChangeBar
            change={briefSettingsChange(brief.writtenFor, { language, lengthSec })}
            keptFor={keptFor}
            ai={ai}
            onKeep={setKeptFor}
            onRegenerate={() => makeBrief("settings", { from: "settings" })}
          />
        ) : null}

        {brief.brief && editingBrief ? (
          <BriefEditor
            projectId={projectId}
            brief={brief.brief}
            briefUpdatedAt={brief.updatedAt}
            onCancel={() => setEditingBrief(false)}
            onSaved={(data) => {
              setBrief(briefStateOf(data));
              setChanged([]);
              setEditingBrief(false);
              onProject(data.project);
            }}
            onLatest={(idea) => {
              setBrief(briefStateOf(idea));
              setChanged([]);
              setEditingBrief(false);
            }}
          />
        ) : brief.brief ? (
          <BriefCard
            onEdit={editable ? () => setEditingBrief(true) : undefined}
            brief={brief.brief}
            alternatives={brief.alternatives}
            editable={editable}
            ai={ai}
            // The brief being looked at: a repeated or retried switch then can't swap back (the server keeps the current one).
            onSwitch={(index) => makeBrief(`angle:${index}`, { from: "alternative", index, ...(brief.updatedAt && { briefUpdatedAt: brief.updatedAt }) })}
            changed={changed}
          >
            <IdeaChat
              projectId={projectId}
              initial={initialChat}
              editable={editable}
              ai={ai}
              onSend={() => setChanged([])}
              onStale={() => {
                // Show the brief as it is now (another tab or a new brief changed it); "Send again" then works on that.
                void apiCall<Idea>(`/api/v1/projects/${projectId}/idea`)
                  // Unless a newer brief arrived meanwhile ("Send again" answered first): never go back to an older one.
                  .then(({ data }) => setBrief((b) => (b.updatedAt && data.briefUpdatedAt && Date.parse(data.briefUpdatedAt) < Date.parse(b.updatedAt) ? b : briefStateOf(data))))
                  .catch(() => {}); // the next message's answer brings it anyway
              }}
              onAnswer={(reply) => {
                // A chat change edits the brief in the language and length it was written for (as its angles are), so the
                // settings bar stays until the brief and both angles are rewritten together; still the same card's brief.
                if (reply.brief) setBrief((b) => ({ ...b, brief: reply.brief, updatedAt: reply.briefUpdatedAt }));
                setChanged(reply.assistantMessage.changedFields);
                onProject(reply.project);
              }}
            />
          </BriefCard>
        ) : (
          <EmptyBrief />
        )}

        {settings}

        <GenerateCard keyPoints={brief.brief?.keyPoints.length ?? null} status={status} editable={editable} aiIdle={ai.idle} storyboard={storyboard} />
      </div>
    </div>
  );
}

/** The brief state the page keeps, from an idea session or a brief answer. */
function briefStateOf(i: {
  brief: Brief | null;
  briefAlternatives?: Brief[];
  alternatives?: Brief[];
  briefUpdatedAt: string | null;
  briefLanguage: Idea["briefLanguage"];
  briefLengthSec: Idea["briefLengthSec"];
  briefCardId: string | null;
}): BriefState {
  return {
    brief: i.brief,
    alternatives: i.alternatives ?? i.briefAlternatives ?? [],
    updatedAt: i.briefUpdatedAt,
    writtenFor: { language: i.briefLanguage, lengthSec: i.briefLengthSec },
    cardId: i.briefCardId,
  };
}

function Clipped({ show, max }: { show: boolean; max: number }) {
  return show ? (
    <p role="status" className="text-sm text-orange">
      That was longer than {max.toLocaleString("en-IN")} characters, so the end was cut off.
    </p>
  ) : null;
}

/** Before there's a brief: where it will appear (Stitch 09 always shows the brief card). */
function EmptyBrief() {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <Eyebrow>brief</Eyebrow>
      <p className="text-sm text-muted">Your brief appears here: pick an idea, sharpen your own, or turn your notes into one. Then refine it with the AI.</p>
    </Card>
  );
}

/**
 * F2.6 follow-up: the video's language or length changed after its brief was written ("Regenerate brief in Hindi?",
 * PRD F2). Regenerate rewrites the brief and its angles (one request); Keep as is hides this until the next reload.
 */
function SettingsChangeBar(props: { change: ReturnType<typeof briefSettingsChange>; keptFor: string | null; ai: IdeaAi; onKeep: (key: string) => void; onRegenerate: () => void }) {
  const { change, keptFor, ai, onKeep, onRegenerate } = props;
  if (!change || keptFor === change.key) return null;
  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-orange/40 bg-orange/5 px-4 py-3">
      <p className="text-sm">{change.message}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!ai.canAsk} onClick={onRegenerate} aria-busy={ai.busy === "settings"}>
          {ai.busy === "settings" ? "Thinking…" : change.action}
        </Button>
        <Button type="button" variant="ghost" disabled={ai.busy === "settings"} onClick={() => onKeep(change.key)}>
          Keep as is
        </Button>
        <Thinking busy={ai.busy === "settings" ? "settings" : null} />
      </div>
    </div>
  );
}

export type IdeaAi = ReturnType<typeof useIdeaAi>;
export type AiErrorState = { message: string; reason?: string; code?: string } | null;

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

  /** `ownError`: the caller shows the error itself (the chat, next to its message); the limit lock applies either way. */
  const run = useCallback(async (kind: string, fn: () => Promise<void>, ownError?: (error: NonNullable<AiErrorState>) => void) => {
    if (asking.current) return;
    asking.current = true;
    setBusy(kind);
    setError(null);
    const show = (e: NonNullable<AiErrorState>) => (ownError ? ownError(e) : setError(e));
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof ApiClientError)) {
        show({ message: err instanceof Error && err.message ? err.message : "Something went wrong. Please try again." });
      } else {
        const issue = err.details[0]?.issue;
        show({ message: err.message, code: err.code, reason: err.code === "UNSAFE_CONTENT" && typeof issue === "string" ? issue : undefined });
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

export function Thinking({ busy }: { busy: string | null }) {
  // Switching angle makes no AI call.
  if (!busy || busy.startsWith("angle:")) return null;
  return (
    <span role="status" className="font-mono text-xs text-violet">
      <Slashes />
      {busy === "notes" ? "the AI is reading your notes — up to 25 seconds" : "the AI is thinking — usually about 10 seconds"}
    </span>
  );
}

export function AiError({ error }: { error: AiErrorState }) {
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
 * the brief (F2.3); the card the brief came from is marked Selected (F2.7). Stitch 09: the topic and "Suggest ideas"
 * on one row, key points as mono tags.
 */
function TopicIdeas(props: {
  projectId: string;
  topic: string;
  onTopic: (value: string) => void;
  clipped: boolean;
  initial: Suggestion[];
  selectedId: string | null;
  editable: boolean;
  ai: IdeaAi;
  onUse: (card: Suggestion) => void;
}) {
  const { projectId, topic, onTopic, clipped, initial, selectedId, editable, ai, onUse } = props;
  const [cards, setCards] = useState<Suggestion[]>(initial);
  const trimmed = topic.trim();
  const busy = ai.busy;
  const suggestButton = useRef<HTMLButtonElement>(null);

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
      <TextBox
        label="What subject or niche?"
        hint="For example: photosynthesis for Class 7, or personal finance basics. The AI will suggest 5 video ideas."
        value={topic}
        max={LIMITS.topicInput}
        onChange={onTopic}
        // Enter asks for ideas, like pressing "Suggest ideas" (a no-op while that button is disabled).
        onEnter={() => suggestButton.current?.click()}
        readOnly={!editable}
        action={
          <Button ref={suggestButton} type="button" className="shrink-0" disabled={!canAsk || !trimmed} onClick={() => ask("new", trimmed, cards)} aria-busy={busy === "new"}>
            {busy === "new" ? "Thinking…" : "Suggest ideas"}
          </Button>
        }
      />
      <Clipped show={clipped} max={LIMITS.topicInput} />
      {(!trimmed && editable) || busy ? (
        <div className="flex flex-wrap items-center gap-3">
          {!trimmed && editable ? <span className="text-xs text-muted">Type a subject first.</span> : null}
          <Thinking busy={busy} />
        </div>
      ) : null}

      <AiError error={ai.error} />

      {cards.length ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-sm text-violet"><Slashes />
              {`${cards.length} idea${cards.length === 1 ? "" : "s"}`}</p>
            {/* Visible, not only a tooltip: phones can't hover. */}
            <p className="text-xs text-muted">“Use this” turns an idea into your brief.</p>
          </div>
          <ul className="flex flex-col gap-3" aria-label="Video ideas">
            {newestFirst.map((c) => {
              const selected = c.id === selectedId;
              return (
                <li
                  key={c.id}
                  aria-current={selected ? "true" : undefined}
                  className={cx("flex flex-col gap-3 rounded-xl border p-4", selected ? "border-cyan/60 bg-cyan/5 glow-cyan" : "border-line bg-raised")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="flex items-start gap-2 text-base font-semibold leading-snug">
                      {selected ? (
                        <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-cyan/20 text-xs text-cyan">
                          ✓
                        </span>
                      ) : null}
                      {c.title}
                    </h3>
                    {/* In words, not colour alone: the brief is built on this idea. */}
                    {selected ? <span className="shrink-0 rounded-md border border-cyan/40 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-cyan">Selected</span> : null}
                  </div>
                  <p className="text-sm">{c.hook}</p>
                  <p className="text-sm text-muted">{c.angle}</p>
                  <ul className="flex flex-wrap gap-2" aria-label="Key points">
                    {c.keyPoints.map((k, i) => (
                      <li key={i} className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-muted">
                        {`[${k}]`}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                    <Button type="button" variant="ghost" className="font-mono text-xs" disabled={!canAsk} onClick={() => ask(c.id, c.title, cards)} aria-busy={busy === c.id} aria-label={`More like this: ${c.title}`}>
                      {busy === c.id ? "Thinking…" : "More like this"}
                    </Button>
                    <Button type="button" variant={selected ? "primary" : "secondary"} disabled={!canAsk} onClick={() => onUse(c)} aria-busy={busy === `use:${c.id}`} aria-label={`Use this: ${c.title}`}>
                      {busy === `use:${c.id}` ? "Thinking…" : "Use this"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-center">
            <Button type="button" variant="secondary" className="rounded-full px-5 font-mono text-xs" disabled={!canAsk || !trimmed} onClick={() => ask("more", trimmed, cards)} aria-busy={busy === "more"}>
              <span aria-hidden className="text-cyan">
                ✦
              </span>
              {busy === "more" ? "Thinking…" : "Suggest 5 more"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The brief (F2.3, Stitch 09): what the video will be — each field under a mono label — with Edit (F2.8), the 2 other
 * angles to switch to, and the chat to refine it (F2.5, passed in as `children`, under "// refine with ai").
 */
function BriefCard(props: {
  brief: Brief;
  alternatives: Brief[];
  editable: boolean;
  ai: IdeaAi;
  onSwitch: (index: number) => void;
  changed: string[];
  onEdit?: () => void;
  children?: React.ReactNode;
}) {
  const { brief, alternatives, editable, ai, onSwitch, changed, onEdit, children } = props;
  // A field the last chat answer changed: outlined (with a little room), and a "changed" tag. Screen readers hear
  // ", changed" as its own words, not run into the text ("Kids (8–12)changed").
  const mark = (field: string) => (changed.includes(field) ? "-mx-1 rounded-md px-1 outline outline-1 outline-offset-2 outline-cyan" : undefined);
  const tag = (field: string) =>
    changed.includes(field) ? (
      <>
        <span className="sr-only">, changed</span>
        <span aria-hidden className="ml-2 font-mono text-xs text-cyan">
          changed
        </span>
      </>
    ) : null;
  const audience = AUDIENCE_OPTIONS.find((o) => o.value === brief.audience)?.label ?? brief.audience;
  const label = (text: string, field?: string) => (
    <dt className="font-mono text-xs text-muted">
      <Slashes />
      {text}
      {field ? tag(field) : null}
    </dt>
  );
  return (
    <Card className="flex flex-col gap-5 p-5">
      <section aria-labelledby="brief-title" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>brief</Eyebrow>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-mono text-xs text-green">
              <span aria-hidden className="size-1.5 rounded-full bg-green shadow-[0_0_8px_var(--green)]" />
              ready
            </span>
            {onEdit ? (
              // Not while an AI request runs: its answer would replace the brief being edited.
              <Button type="button" variant="ghost" className="px-2 py-1 text-sm" disabled={!ai.idle} onClick={onEdit}>
                Edit
              </Button>
            ) : null}
          </span>
        </div>
        <h3 id="brief-title" className={cx("text-xl font-semibold leading-snug", mark("title"))}>
          {brief.title}
          {tag("title")}
        </h3>
        <dl className="flex flex-col gap-1 text-sm [&>dd]:mb-2.5">
          {label("hook", "hook")}
          <dd className={mark("hook")}>“{brief.hook}”</dd>
          {label("angle", "angle")}
          <dd className={mark("angle")}>{brief.angle}</dd>
          {label("audience", "audience")}
          <dd className={mark("audience")}>{audience}</dd>
          {brief.sourceNotesSummary ? (
            <>
              {label("from your notes")}
              <dd>{brief.sourceNotesSummary}</dd>
            </>
          ) : null}
          {label("key points", "keyPoints")}
          <dd className={mark("keyPoints")}>
            <ol className="flex list-disc flex-col gap-1 pl-5 marker:text-cyan">
              {brief.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ol>
          </dd>
          {brief.outOfScope.length ? (
            <>
              {label("left out to fit the length", "outOfScope")}
              <dd className={mark("outOfScope")}>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
                  {brief.outOfScope.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      {alternatives.length ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h4 className="font-mono text-xs text-muted"><Slashes />
            other angles</h4>
          <ul className="flex flex-col gap-2" aria-label="Other angles">
            {alternatives.map((a, i) => (
              <li key={`${i}-${a.title}`} className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3">
                <p className="text-sm font-medium leading-snug">{a.title}</p>
                <p className="text-xs text-muted">{a.angle}</p>
                <div>
                  <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!editable || !ai.idle} onClick={() => onSwitch(i)} aria-busy={ai.busy === `angle:${i}`} aria-label={`Use this angle: ${a.title}`}>
                    {ai.busy === `angle:${i}` ? "Switching…" : "Use this angle"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {children ? <div className="border-t border-line pt-4">{children}</div> : null}
    </Card>
  );
}

function TextBox(props: {
  label: string;
  hint: string;
  value: string;
  max: number;
  rows?: number;
  readOnly: boolean;
  onChange: (v: string) => void;
  onEnter?: () => void;
  /** A button beside a one-line input (Stitch 09's topic row); it wraps under the input on a narrow screen. */
  action?: React.ReactNode;
}) {
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
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1 basis-56">
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
          </div>
          {props.action}
        </div>
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
