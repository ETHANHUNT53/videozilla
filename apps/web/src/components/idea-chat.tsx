"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiCall } from "@/lib/api-client";
import { loadChatDraft, saveChatDraft } from "@/lib/chat-draft";
import type { ChatMessageResource, IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { AiError, Thinking, type AiErrorState, type IdeaAi } from "./idea-step";
import { cx, inputStyles } from "./ui";

type Brief = NonNullable<IdeaSessionResource["brief"]>;
/** `POST …/idea/chat` (F2.5). */
export type ChatReply = {
  userMessage: ChatMessageResource;
  assistantMessage: ChatMessageResource;
  brief: Brief | null;
  briefUpdatedAt: string | null;
  project: ProjectResource;
};

/** Same limit as the API (characters, so an emoji or a Hindi letter is one). */
const MAX = 1_000;
const count = (s: string) => Array.from(s).length;

/** A message that's been sent from this page but has no answer yet (or failed): shown until the answer replaces it. */
type Outgoing = { clientMessageId: string; content: string; error: AiErrorState };

/**
 * The idea chat under the brief (PRD F2-FR5, F2.5): ask for a change in your own words; the answer updates the brief in
 * place (the Idea step highlights what changed). One AI request at a time with the rest of the Idea step; unsent text
 * is kept in this browser; a failed message can be sent again with the same id (the API is idempotent on it).
 */
export function IdeaChat(props: {
  projectId: string;
  initial: { items: ChatMessageResource[]; hasOlder: boolean };
  editable: boolean;
  ai: IdeaAi;
  /** A message is about to go out (the previous highlight ends). */
  onSend: () => void;
  onAnswer: (reply: ChatReply) => void;
  /** The brief changed while a message was answered (412): reload it. */
  onStale: () => void;
}) {
  const { projectId, initial, editable, ai, onSend, onAnswer, onStale } = props;
  const [thread, setThread] = useState<ChatMessageResource[]>(initial.items);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  // Read after mount: the server render has no storage, so starting empty keeps hydration consistent. The draft is
  // only written when it changes by hand (typing, sending), never from an effect: an effect would run with the empty
  // first value and wipe the stored draft (in dev, StrictMode's second run then read nothing back; QA, F2.5).
  const [draft, setDraft] = useState("");
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    // Restoring the draft from browser storage after mount (it isn't there during the server render). Reads only.
    const saved = loadChatDraft(projectId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setDraft((d) => d || saved);
  }, [projectId]);
  const changeDraft = (value: string) => {
    setDraft(value);
    saveChatDraft(projectId, value);
  };
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [thread.length, outgoing.length]);

  const send = (clientMessageId: string, content: string) => {
    onSend();
    setOutgoing((o) => [...o.filter((m) => m.clientMessageId !== clientMessageId), { clientMessageId, content, error: null }]);
    void ai.run(
      "chat",
      async () => {
        const { data } = await apiCall<ChatReply>(`/api/v1/projects/${projectId}/idea/chat`, { method: "POST", body: { clientMessageId, content } });
        setOutgoing((o) => o.filter((m) => m.clientMessageId !== clientMessageId));
        // A failed earlier try of the same message is in the loaded thread: the answered one replaces it.
        setThread((t) => [...t.filter((m) => m.clientMessageId !== clientMessageId && m.id !== data.userMessage.id && m.id !== data.assistantMessage.id), data.userMessage, data.assistantMessage]);
        onAnswer(data);
      },
      (error) => {
        setOutgoing((o) => o.map((m) => (m.clientMessageId === clientMessageId ? { ...m, error } : m)));
        // The brief changed elsewhere (another tab, a new brief) while this was answered: show the current one.
        if (error.code === "PRECONDITION_FAILED") onStale();
      },
    );
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || !ai.canAsk || !editable) return;
    changeDraft("");
    send(crypto.randomUUID(), content);
  };

  const failedInThread = (m: ChatMessageResource) => m.role === "user" && m.status === "failed" && !outgoing.some((o) => o.clientMessageId === m.clientMessageId);
  const used = count(draft);

  return (
    // Inside the brief card (Stitch 09, F2.7), under "// refine with ai".
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h4 id={`${id}-title`} className="font-mono text-xs text-muted">
        <span className="sr-only">Refine the brief: </span>
        {"// refine with ai"}
      </h4>
      {initial.hasOlder ? <p className="text-xs text-muted">Older messages aren&apos;t shown here.</p> : null}
      {thread.length || outgoing.length ? (
        <ol ref={listRef} className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" aria-label="Conversation about the brief">
          {thread.map((m) => (
            <li key={m.id} className={bubble(m.role)}>
              {m.role === "user" ? (
                <span className="sr-only">You: </span>
              ) : (
                <span className="mb-1 block font-mono text-[11px] text-violet">
                  <span className="sr-only">AI: </span>
                  <span aria-hidden>{"// ai"}</span>
                </span>
              )}
              {m.content}
              {m.role === "assistant" && m.status === "applied" && m.changedFields.length ? <span className="mt-1 block font-mono text-xs text-cyan">{"// brief updated"}</span> : null}
              {m.role === "user" && m.status === "pending" && !outgoing.some((o) => o.clientMessageId === m.clientMessageId) ? (
                // Being answered by a request from another tab or an earlier visit: reload to see the answer.
                <span className="mt-1 block font-mono text-xs text-muted">being answered… reload to see the answer</span>
              ) : null}
              {failedInThread(m) ? (
                <span className="mt-1 flex items-center gap-2 text-xs text-orange">
                  Not answered.
                  {editable ? (
                    <button type="button" className="underline disabled:opacity-50" disabled={!ai.canAsk} onClick={() => send(m.clientMessageId!, m.content)}>
                      Send again
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
          {outgoing.map((m) => (
            <li key={m.clientMessageId} className={bubble("user")}>
              <span className="sr-only">You: </span>
              {m.content}
              {m.error ? (
                <span className="mt-1 flex flex-col gap-1">
                  <AiError error={m.error} />
                  <button type="button" className="self-start text-xs underline disabled:opacity-50" disabled={!ai.canAsk} onClick={() => send(m.clientMessageId, m.content)}>
                    Send again
                  </button>
                </span>
              ) : (
                <span className="mt-1 block font-mono text-xs text-muted">sending…</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Ask for a change in your own words, for example &quot;make the hook more surprising&quot; or &quot;focus on the second point&quot;.</p>
      )}
      {editable ? (
        <form
          method="post"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={`${id}-input`} className="sr-only">
            Your message
          </label>
          {/* Stitch 09: one line with a send arrow inside; it grows with Shift+Enter. */}
          <div className="relative">
            <textarea
              id={`${id}-input`}
              rows={1}
              value={draft}
              maxLength={MAX * 2}
              // Short, so it fits a phone (360 px) on one or two lines.
              placeholder="Ask for a change, e.g. focus on point 2"
              onChange={(e) => changeDraft(Array.from(e.target.value).slice(0, MAX).join(""))}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter is a new line; not while an input method (Hindi typing) is composing.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-describedby={`${id}-count`}
              className={cx(inputStyles, "min-h-11 resize-y py-3 pr-12 leading-relaxed")}
            />
            <button
              type="submit"
              aria-label={ai.busy === "chat" ? "Thinking…" : "Send"}
              aria-busy={ai.busy === "chat"}
              disabled={!ai.canAsk || !draft.trim()}
              className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-lg bg-cyan text-bg transition-colors hover:bg-cyan/90 disabled:bg-surface disabled:text-muted"
            >
              <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Thinking busy={ai.busy === "chat" ? "chat" : null} />
            {/* The count only once it matters (the limit is 1,000). */}
            <span id={`${id}-count`} className={cx("ml-auto font-mono text-xs text-muted", used < MAX - 200 && "sr-only", used >= MAX && "text-orange")}>
              {used.toLocaleString("en-IN")} / {MAX.toLocaleString("en-IN")}
            </span>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const bubble = (role: "user" | "assistant") =>
  cx("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", role === "user" ? "self-end border border-line bg-surface" : "self-start border border-violet/40 bg-violet/10");
