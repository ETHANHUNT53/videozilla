import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChatDraft, saveChatDraft } from "./chat-draft";

/** Unsent idea-chat text in localStorage (F2.5): per video, and never breaking the page when storage fails. */

afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("chat drafts", () => {
  it("are kept per video and removed once empty", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    saveChatDraft("p1", "make it for kids");
    saveChatDraft("p2", "other video");
    expect(loadChatDraft("p1")).toBe("make it for kids");
    expect(store.data.get("vz:idea-chat-draft:p2")).toBe("other video");
    saveChatDraft("p1", "   ");
    expect(loadChatDraft("p1")).toBe("");
    expect(store.data.has("vz:idea-chat-draft:p1")).toBe(false);
  });

  it("missing or throwing storage: nothing kept, nothing thrown", () => {
    expect(loadChatDraft("p1")).toBe(""); // no localStorage in this environment
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => saveChatDraft("p1", "x")).not.toThrow();
    expect(loadChatDraft("p1")).toBe("");
  });
});
