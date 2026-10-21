"use client";

import { hashtagHint, normalizeHashtag, normalizeHashtags, postedText, SOCIAL_LIMITS, socialCounts, socialProblems, type Social } from "@videozilla/schema";
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
  onStale: (action: StaleAction) => void;
}) {
  const { projectId, version, onSaved, onStale } = props;
  const saved = version.storyboard.social;
  const [draft, setDraft] = useState<Social | null>(null);
  const [aiNote, setAiNote] = useState(false);
  const [busy, setBusy] = useState<"save" | "rewrite" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState(false);

  // An edit refused with 412 before the reload (see save): back in the form, on the newer storyboard.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const kept = takeCaptionDraft(projectId);
    if (!kept) return;
    // Restoring from browser storage, once after mount (it isn't there during the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(kept);
    setRestored(true);
  }, [projectId]);

  const shown = draft ?? saved;
  const counts = socialCounts(shown);
  const hint = hashtagHint(shown.hashtags.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(postedText(saved));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy here. Select the caption and copy it yourself.");
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      const { data } = await apiCall<{ version: StoryboardVersionResource; project: ProjectResource }>(`/api/v1/projects/${projectId}/storyboard/social`, {
        method: "PATCH",
        body: draft,
        headers: { "If-Match": `"${version.version}"` },
      });
      setDraft(null);
      setAiNote(false);
      setRestored(false);
      onSaved(data.version, data.project);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save the caption. Please try again.");
      // The storyboard moved on (regenerated, or edited in another tab): show it as it is now. A 412 keeps the edit for
      // this tab, so it's back in the form once the newer storyboard has loaded (this panel remounts with it).
      if (err instanceof ApiClientError && (err.code === "PRECONDITION_FAILED" || isStaleState(err))) {
        if (err.code === "PRECONDITION_FAILED") keepCaptionDraft(projectId, draft);
        setDraft(null);
        onStale("caption_edit");
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
      setDraft(data.social);
      setAiNote(true);
      setAsking(false);
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
            <Button type="button" variant="ghost" className="px-2.5 py-1 font-mono text-xs" onClick={() => setDraft({ ...saved, hashtags: [...saved.hashtags] })}>
              Edit
            </Button>
            <Button type="button" variant="secondary" className="px-2.5 py-1 font-mono text-xs" onClick={() => setAsking((a) => !a)} aria-expanded={asking} disabled={busy !== null}>
              ✨ Rewrite with AI
            </Button>
          </div>
        )}
      </div>

      {asking && !draft ? (
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
        <SocialForm draft={draft} onChange={setDraft} aiNote={aiNote} />
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
function SocialForm({ draft, onChange, aiNote }: { draft: Social; onChange: (s: Social) => void; aiNote: boolean }) {
  const id = useId();
  const [tagInput, setTagInput] = useState("");
  const tagBox = useRef<HTMLInputElement>(null);
  const problems = socialProblems(draft);

  const addTags = (raw: string) => {
    const parts = splitTags(raw).map((p) => normalizeHashtag(p)).filter((t): t is string => t !== null);
    if (!parts.length) return;
    onChange({ ...draft, hashtags: normalizeHashtags([...draft.hashtags, ...parts]) });
    setTagInput("");
  };

  return (
    <div className="flex flex-col gap-4">
      {aiNote ? <p className="rounded-lg border border-violet/40 bg-violet/5 px-3 py-2 text-sm">AI suggestion. Change anything, then Save to keep it.</p> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-caption`} className="font-mono text-xs text-muted">
          caption
        </label>
        <textarea
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
        />
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
