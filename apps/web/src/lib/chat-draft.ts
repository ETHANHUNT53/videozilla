/**
 * Unsent idea-chat text, kept in this browser per video (PRD F10-FR1: "Unsent chat text is also kept in
 * localStorage"; M2 design D1), so leaving the page or being signed out doesn't lose it. Storage can be missing or
 * throw (private windows, blocked site data), so every access is wrapped: the chat works the same without it.
 */

const key = (projectId: string) => `vz:idea-chat-draft:${projectId}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadChatDraft(projectId: string): string {
  try {
    return storage()?.getItem(key(projectId)) ?? "";
  } catch {
    return "";
  }
}

/** Saves the draft; an empty one is removed. */
export function saveChatDraft(projectId: string, text: string): void {
  try {
    const s = storage();
    if (!s) return;
    if (text.trim()) s.setItem(key(projectId), text);
    else s.removeItem(key(projectId));
  } catch {
    // Full or blocked storage: the draft just isn't kept.
  }
}
