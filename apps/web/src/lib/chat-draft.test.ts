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

  it("restoring only reads: a reload, or React StrictMode running the restore twice, never wipes the draft (QA, F2.5)", () => {
    const store = memoryStorage();
    const writes = { set: 0, remove: 0 };
    vi.stubGlobal("localStorage", {
      getItem: store.getItem,
      setItem: (k: string, v: string) => {
        writes.set++;
        store.setItem(k, v);
      },
      removeItem: (k: string) => {
        writes.remove++;
        store.removeItem(k);
      },
    });
    saveChatDraft("p1", "focus on the second point"); // typed, then the page reloads
    writes.set = 0;
    // The chat box restores in an effect after mount; StrictMode (next dev) mounts, unmounts and mounts again.
    expect(loadChatDraft("p1")).toBe("focus on the second point");
    expect(loadChatDraft("p1")).toBe("focus on the second point");
    expect(writes).toEqual({ set: 0, remove: 0 });
    // Only a change by hand writes: sending clears it.
    saveChatDraft("p1", "");
    expect(writes.remove).toBe(1);
    expect(loadChatDraft("p1")).toBe("");
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
