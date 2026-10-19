"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiCall } from "@/lib/api-client";
import { loadChatDraft, saveChatDraft } from "@/lib/chat-draft";
import type { ChatMessageResource, IdeaSessionResource, ProjectResource } from "@/server/api/resources";
import { AiError, Thinking, type AiErrorState, type IdeaAi } from "./idea-step";
import { Button, cx, inputStyles } from "./ui";

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
}) {
  const { projectId, initial, editable, ai, onSend, onAnswer } = props;
  const [thread, setThread] = useState<ChatMessageResource[]>(initial.items);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  // Read after mount: the server render has no storage, so starting empty keeps hydration consistent.
  const [draft, setDraft] = useState("");
  const loaded = useRef(false);
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    // Restoring the draft from browser storage, once after mount (it isn't there during the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadChatDraft(projectId));
    loaded.current = true;
  }, [projectId]);
  useEffect(() => {
    if (loaded.current) saveChatDraft(projectId, draft);
  }, [projectId, draft]);
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
      (error) => setOutgoing((o) => o.map((m) => (m.clientMessageId === clientMessageId ? { ...m, error } : m))),
    );
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || !ai.canAsk || !editable) return;
    setDraft("");
    send(crypto.randomUUID(), content);
  };

  const failedInThread = (m: ChatMessageResource) => m.role === "user" && m.status === "failed" && !outgoing.some((o) => o.clientMessageId === m.clientMessageId);
  const used = count(draft);

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4">
      <h4 id={`${id}-title`} className="text-sm font-medium">
        Refine the brief
      </h4>
      {initial.hasOlder ? <p className="text-xs text-muted">Older messages aren&apos;t shown here.</p> : null}
      {thread.length || outgoing.length ? (
        <ol ref={listRef} className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" aria-label="Conversation about the brief">
          {thread.map((m) => (
            <li key={m.id} className={bubble(m.role)}>
              <span className="sr-only">{m.role === "user" ? "You: " : "AI: "}</span>
              {m.content}
              {m.role === "assistant" && m.status === "applied" && m.changedFields.length ? <span className="mt-1 block font-mono text-xs text-cyan">{"// brief updated"}</span> : null}
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
        <p className="text-sm text-muted">Ask for a change in your own words, for example &quot;make it for kids&quot; or &quot;focus on the second point&quot;.</p>
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
          <textarea
            id={`${id}-input`}
            rows={2}
            value={draft}
            maxLength={MAX * 2}
            placeholder="Ask for a change — e.g. make it for kids, focus on the second point"
            onChange={(e) => setDraft(Array.from(e.target.value).slice(0, MAX).join(""))}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a new line; not while an input method (Hindi typing) is composing.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            aria-describedby={`${id}-count`}
            className={cx(inputStyles, "resize-y leading-relaxed")}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!ai.canAsk || !draft.trim()} aria-busy={ai.busy === "chat"}>
                {ai.busy === "chat" ? "Thinking…" : "Send"}
              </Button>
              <Thinking busy={ai.busy === "chat" ? "chat" : null} />
            </div>
            <span id={`${id}-count`} className={cx("font-mono text-xs text-muted", used >= MAX && "text-orange")}>
              {used.toLocaleString("en-IN")} / {MAX.toLocaleString("en-IN")}
            </span>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const bubble = (role: "user" | "assistant") =>
  cx("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", role === "user" ? "self-end bg-cyan/10" : "self-start border border-line bg-surface");
