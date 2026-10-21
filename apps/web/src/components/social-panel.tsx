"use client";

import { checkHashtag, hashtagHint, postedText, SOCIAL_LIMITS, socialCounts, socialProblems, type Social } from "@videozilla/schema";
import { useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { keepCaptionDraft, takeCaptionDraft } from "@/lib/caption-draft";
import { isStaleState, splitTags, type StaleAction } from "@/lib/storyboard-run";
import type { ProjectResource, StoryboardVersionResource } from "@/server/api/resources";
import { Button, Card, Eyebrow, cx, inputStyles } from "./ui";

/**
 * The Instagram panel (F3.4, Stitch 10's caption card): the caption, hashtags and cover text as they'll be posted,
 * with Copy, Edit (Save / Cancel: each Save is a new storyboard version) and Rewrite with AI (fills the form; Save keeps
 * it). Instagram's limits are checked as you type with the same rules the server uses (schema `social`).
 * See docs/features/F3.4-caption-hashtags.md.
 */
export function SocialPanel(props: {
  projectId: string;
  version: StoryboardVersionResource;
  onSaved: (version: StoryboardVersionResource, project: ProjectResource) => void;
  onStale: (action: StaleAction, opts?: { quiet?: boolean }) => void;
  /** Edit opened or a save went through: the page's "moved on in another tab" line is old news. */
  onActivity: () => void;
  /** F3.5: an older version opened from the history: no Edit or Rewrite. */
  readOnly?: boolean;
}) {
  const { projectId, version, onSaved, onStale, onActivity, readOnly = false } = props;
  const saved = version.storyboard.social;
  const [draft, setDraft] = useState<Social | null>(null);
  const [aiNote, setAiNote] = useState(false);
  const [busy, setBusy] = useState<"save" | "rewrite" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState(false);
  // The clipboard was blocked: the text is shown selected, ready for Ctrl+C (QA, F3.4).
  const [copyBox, setCopyBox] = useState(false);
  const copyArea = useRef<HTMLTextAreaElement>(null);
  // Focus: into the caption when the form opens, back to Edit when it closes (QA, F3.4).
  const editButton = useRef<HTMLButtonElement>(null);
  const captionBox = useRef<HTMLTextAreaElement>(null);
  const focusAfter = useRef<"caption" | "edit" | null>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (focusAfter.current === "caption" && editing) captionBox.current?.focus();
    if (focusAfter.current === "edit" && !editing) editButton.current?.focus();
    focusAfter.current = null;
  }, [editing]);
  useEffect(() => {
    if (copyBox) copyArea.current?.select();
  }, [copyBox]);

  // An edit refused with 412 before the reload (see save): back in the form, on the newer storyboard.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    // Not into an older version opened read-only from the history (F3.5): it waits for the current one.
    if (readOnly) return;
    const kept = takeCaptionDraft(projectId);
    if (!kept) return;
    // Restoring from browser storage, once after mount (it isn't there during the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(kept);
    setRestored(true);
  }, [projectId, readOnly]);

  const shown = draft ?? saved;
  const counts = socialCounts(shown);
  const hint = hashtagHint(shown.hashtags.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(postedText(saved));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Blocked (permissions, an embedded page): show the text selected, so Ctrl+C / Copy copies it.
      setCopyBox(true);
    }
  };

  const openEdit = () => {
    setCopyBox(false);
    setError(null);
    onActivity();
    focusAfter.current = "caption";
    setDraft({ ...saved, hashtags: [...saved.hashtags] });
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      const { data } = await apiCall<{ version: StoryboardVersionResource; project: ProjectResource }>(`/api/v1/projects/${projectId}/storyboard/social`, {
        method: "PATCH",
        body: aiNote ? { ...draft, fromRewrite: true } : draft,
        headers: { "If-Match": `"${version.version}"` },
      });
      focusAfter.current = "edit";
      setDraft(null);
      setAiNote(false);
      setRestored(false);
      onActivity();
      onSaved(data.version, data.project);
    } catch (err) {
      // The storyboard moved on (regenerated, or edited in another tab): show it as it is now. A 412 keeps the edit for
      // this tab and puts it back in the form once the newer storyboard has loaded, with its own note; the page then
      // adds no "wasn't saved" line of its own (QA: the two contradicted each other).
      if (err instanceof ApiClientError && err.code === "PRECONDITION_FAILED") {
        keepCaptionDraft(projectId, draft);
        setDraft(null);
        setError(null);
        onStale("caption_edit", { quiet: true });
      } else {
        setError(err instanceof ApiClientError ? err.message : "Couldn't save the caption. Please try again.");
        if (isStaleState(err)) {
          setDraft(null);
          onStale("caption_edit");
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async () => {
    setBusy("rewrite");
    setError(null);
    try {
      const { data } = await apiCall<{ social: Social }>(`/api/v1/projects/${projectId}/storyboard/social/rewrite`, {
        method: "POST",
        body: instruction.trim() ? { instruction: instruction.trim() } : {},
      });
      focusAfter.current = "caption";
      setDraft(data.social);
      setAiNote(true);
      setAsking(false);
      setCopyBox(false);
      onActivity();
    } catch (err) {
      setError(err instanceof ApiClientError ? (err.code === "UNSAFE_CONTENT" ? `${err.message} ${err.details[0]?.issue ?? ""}`.trim() : err.message) : "Couldn't rewrite the caption. Please try again.");
      if (isStaleState(err)) onStale("request");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5" aria-busy={busy !== null}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <Eyebrow>instagram caption</Eyebrow>
        {draft ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="px-2.5 py-1 font-mono text-xs" onClick={copy}>
              {copied ? "Copied ✓" : "Copy text"}
            </Button>
            {readOnly ? null : (
              <>
                <Button ref={editButton} type="button" variant="ghost" className="px-2.5 py-1 font-mono text-xs" onClick={openEdit}>
                  Edit
                </Button>
                <Button type="button" variant="secondary" className="px-2.5 py-1 font-mono text-xs" onClick={() => setAsking((a) => !a)} aria-expanded={asking} disabled={busy !== null}>
                  ✨ Rewrite with AI
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {asking && !draft && !readOnly ? (
        <div className="flex flex-col gap-2">
          <label className="font-mono text-xs text-muted" htmlFor={`${projectId}-instruction`}>
            How should it change? (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${projectId}-instruction`}
              className={cx(inputStyles, "min-w-0 flex-1")}
              value={instruction}
              maxLength={300}
              placeholder="e.g. more fun, fewer emoji"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rewrite();
              }}
            />
            <Button type="button" onClick={rewrite} disabled={busy !== null} aria-busy={busy === "rewrite"}>
              {busy === "rewrite" ? "Thinking…" : "Rewrite"}
            </Button>
          </div>
          <p className="text-xs text-muted">Uses one of today&apos;s revisions. Nothing changes until you save it.</p>
        </div>
      ) : null}

      {draft ? (
        <SocialForm draft={draft} onChange={setDraft} aiNote={aiNote} captionRef={captionBox} />
      ) : (
        <>
          <p className="whitespace-pre-line text-sm leading-relaxed">{saved.caption}</p>
          <ul className="flex flex-wrap gap-2" aria-label="Hashtags">
            {saved.hashtags.map((h) => (
              <li key={h} className="rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs text-muted">
                {h}
              </li>
            ))}
          </ul>
          <p className="font-mono text-xs text-muted">
            <span className="text-cyan">{"// on the cover:"}</span> {saved.coverText}
          </p>
          {copyBox ? (
            <div className="flex flex-col gap-1.5">
              <p role="status" className="text-sm text-orange">
                Couldn&apos;t copy automatically. The text below is selected: press Ctrl+C (⌘C on a Mac), or long-press and Copy.
              </p>
              <textarea
                ref={copyArea}
                readOnly
                aria-label="Caption and hashtags to copy"
                className={cx(inputStyles, "min-h-24 resize-none font-mono text-xs [field-sizing:content]")}
                value={postedText(saved)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          ) : null}
        </>
      )}

      <Counters chars={counts.chars} hashtags={counts.hashtags} hint={hint} />

      {restored && draft ? (
        <p role="status" className="text-sm text-cyan">
          The storyboard changed (another tab or a regenerate), so your edit wasn&apos;t saved. It&apos;s back in the form: Save to keep it on
          the newer storyboard, or Cancel to see the new caption.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}

      {draft ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={busy !== null || socialProblems(draft).length > 0} aria-busy={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy === "save"}
            onClick={() => {
              focusAfter.current = "edit";
              setDraft(null);
              setAiNote(false);
              setRestored(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Counters({ chars, hashtags, hint }: { chars: number; hashtags: number; hint: "few" | "many" | null }) {
  const overChars = chars > SOCIAL_LIMITS.postChars;
  const overTags = hashtags > SOCIAL_LIMITS.hashtags;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-muted" aria-live="polite">
      <span>{hint === "few" ? "Tip: 5–15 hashtags usually work best." : hint === "many" ? "Tip: more than 15 hashtags can look spammy." : ""}</span>
      <span className="flex gap-3">
        <span className={cx(overTags && "text-red")}>
          {hashtags} / {SOCIAL_LIMITS.hashtags} hashtags
        </span>
        <span className={cx(overChars && "text-red")}>
          {chars.toLocaleString("en-IN")} / {SOCIAL_LIMITS.postChars.toLocaleString("en-IN")}
          <span className="sr-only"> characters</span>
        </span>
      </span>
    </div>
  );
}

/** The edit form: caption, hashtag chips with an add box, cover text; the problems that block Save. */
function SocialForm(props: { draft: Social; onChange: (s: Social) => void; aiNote: boolean; captionRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { draft, onChange, aiNote, captionRef } = props;
  const id = useId();
  const [tagInput, setTagInput] = useState("");
  // Why a typed hashtag wasn't added (refused, or already there): never silent (QA, F3.4).
  const [tagNote, setTagNote] = useState<string[]>([]);
  const tagBox = useRef<HTMLInputElement>(null);
  const problems = socialProblems(draft);

  const addTags = (raw: string) => {
    if (!raw.trim()) return;
    const notes: string[] = [];
    const rejected: string[] = [];
    const tags = [...draft.hashtags];
    for (const part of splitTags(raw)) {
      const r = checkHashtag(part);
      if (!r) continue;
      if ("error" in r) {
        notes.push(`${r.error}.`);
        rejected.push(part);
      } else if (tags.some((t) => t.toLowerCase() === r.tag.toLowerCase())) {
        notes.push(`${r.tag} is already there.`);
      } else {
        tags.push(r.tag);
      }
    }
    setTagNote(notes);
    if (tags.length !== draft.hashtags.length) onChange({ ...draft, hashtags: tags });
    // What couldn't be added stays in the box, to fix.
    setTagInput(rejected.join(", "));
  };

  return (
    <div className="flex flex-col gap-4">
      {aiNote ? <p className="rounded-lg border border-violet/40 bg-violet/5 px-3 py-2 text-sm">AI suggestion. Change anything, then Save to keep it.</p> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-caption`} className="font-mono text-xs text-muted">
          caption
        </label>
        <textarea
          ref={captionRef}
          id={`${id}-caption`}
          className={cx(inputStyles, "min-h-28 resize-none [field-sizing:content]")}
          value={draft.caption}
          onChange={(e) => onChange({ ...draft, caption: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-tag`} className="font-mono text-xs text-muted">
          hashtags
        </label>
        <ul className="flex flex-wrap gap-2" aria-label="Hashtags">
          {draft.hashtags.map((h) => (
            <li key={h} className="flex items-center gap-1 rounded-lg border border-line bg-surface py-1 pl-2.5 pr-1 font-mono text-xs">
              {h}
              <button
                type="button"
                className="grid size-5 place-items-center rounded text-muted hover:text-red"
                aria-label={`Remove ${h}`}
                onClick={() => {
                  onChange({ ...draft, hashtags: draft.hashtags.filter((t) => t !== h) });
                  tagBox.current?.focus();
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={tagBox}
          id={`${id}-tag`}
          className={inputStyles}
          value={tagInput}
          placeholder="Add a hashtag and press Enter"
          onChange={(e) => {
            // A comma finishes a tag; spaces inside one are removed ("study with me" → #studywithme).
            const v = e.target.value;
            if (/,$/.test(v) && v.trim()) addTags(v);
            else setTagInput(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTags(tagInput);
            }
          }}
          onBlur={() => addTags(tagInput)}
          aria-describedby={tagNote.length ? `${id}-tag-note` : undefined}
        />
        <div id={`${id}-tag-note`} aria-live="polite" className="contents">
          {tagNote.length ? (
            <ul className="flex flex-col gap-0.5 text-sm text-orange">
              {tagNote.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-cover`} className="font-mono text-xs text-muted">
          cover text (one line, up to {SOCIAL_LIMITS.coverWords} words)
        </label>
        <input id={`${id}-cover`} className={inputStyles} value={draft.coverText} onChange={(e) => onChange({ ...draft, coverText: e.target.value.replace(/[\r\n]+/g, " ") })} />
      </div>
      {problems.length ? (
        <ul className="flex flex-col gap-1 text-sm text-red" aria-live="polite">
          {problems.map((p) => (
            <li key={p.field + p.issue}>{p.field === "coverText" ? `Cover text ${p.issue}.` : `${p.issue[0].toUpperCase()}${p.issue.slice(1)}.`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
