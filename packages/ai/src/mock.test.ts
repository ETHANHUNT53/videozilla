import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { briefIdea, IdeaBriefReply, type IdeaBriefInput } from "./brief";
import { AiBusyError, resetModelCooldowns, type AiCallLog } from "./generate-json";
import { IdeaSuggestionsReply, suggestIdeas, type IdeaSuggestionsInput } from "./ideas";
import { mockBrief, mockIdeas } from "./mock";

/** AI_PROVIDER=mock: sample replies, no network, no keys. */

const fetchSpy = vi.fn(() => Promise.reject(new Error("mock mode must not call the network")));
const topic = (t: string, language: "en" | "hi" = "en", avoidTitles?: string[]): IdeaSuggestionsInput => ({ topic: t, language, audience: "students", avoidTitles });
const idea = (text: string, language: "en" | "hi" = "en", lengthSec: 60 | 90 = 60): IdeaBriefInput => ({ source: { kind: "idea", text }, language, lengthSec, audience: "students" });

async function settle<T>(promise: Promise<T>) {
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("AI_PROVIDER", "mock");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  fetchSpy.mockClear();
  resetModelCooldowns();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mock ideas", () => {
  it("5 schema-valid cards about the topic, marked [Mock], with no network call and no key; logged as provider 'mock'", async () => {
    const logs: AiCallLog[] = [];
    const reply = await settle(suggestIdeas(topic("Photosynthesis"), (l) => void logs.push(l)));
    expect("ideas" in reply && reply.ideas).toHaveLength(5);
    if (!("ideas" in reply)) throw new Error("expected ideas");
    expect(reply.ideas[0].title).toBe("Why Photosynthesis matters more than you think");
    expect(reply.ideas.every((c) => c.hook.startsWith("[Mock]") && c.title.includes("Photosynthesis"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([{ provider: "mock", model: "mock", status: "ok", latencyMs: expect.any(Number), inputTokens: null, outputTokens: null }]);
  });

  it("Hindi topics get Hindi cards", () => {
    const reply = mockIdeas(topic("प्रकाश संश्लेषण", "hi")) as { ideas: { title: string; keyPoints: string[] }[] };
    expect(reply.ideas[0].title).toBe("प्रकाश संश्लेषण क्यों ज़रूरी है?");
    expect(reply.ideas[0].keyPoints[0]).toBe("प्रकाश संश्लेषण क्या है");
  });

  it("'Suggest 5 more' gives the 5 not shown yet; after all 10, numbered repeats keep titles distinct", () => {
    const first = (mockIdeas(topic("Gravity")) as { ideas: { title: string }[] }).ideas.map((c) => c.title);
    const second = (mockIdeas(topic("Gravity", "en", first)) as { ideas: { title: string }[] }).ideas.map((c) => c.title);
    expect(second.some((t) => first.includes(t))).toBe(false);
    const third = (mockIdeas(topic("Gravity", "en", [...first, ...second])) as { ideas: { title: string }[] }).ideas.map((c) => c.title);
    expect(third[0]).toBe("Why Gravity matters more than you think (2)");
    expect(IdeaSuggestionsReply.safeParse({ ideas: third.map((title) => ({ title, hook: "h h", angle: "a a", keyPoints: ["k1", "k2", "k3"] })) }).success).toBe(true);
  });

  it("a long topic is cut at a word, so titles stay within limits", () => {
    const reply = mockIdeas(topic("How the monsoon winds reach Kerala every June and what decides the exact date")) as { ideas: { title: string }[] };
    expect(reply.ideas[0].title).toBe("Why How the monsoon winds reach Kerala every June and… matters more than you think");
    expect(IdeaSuggestionsReply.safeParse(reply).success).toBe(true);
  });

  it("[mock:refuse] returns a refusal (→ 422), [mock:busy] makes the AI busy (→ 503)", async () => {
    await expect(settle(suggestIdeas(topic("anything [mock:refuse]")))).resolves.toMatchObject({ refused: true, category: "other" });
    await expect(settle(suggestIdeas(topic("anything [mock:busy]")))).rejects.toBeInstanceOf(AiBusyError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("mock brief", () => {
  it("a schema-valid brief + 2 other angles; 3 key points for 60 s, 4 for 90 s; Hindi in Hindi", async () => {
    const reply = await settle(briefIdea(idea("Why the sky is blue")));
    expect(IdeaBriefReply.safeParse(reply).success).toBe(true);
    if (!("brief" in reply)) throw new Error("expected a brief");
    expect(reply.brief).toMatchObject({ title: "Why the sky is blue explained in 60 seconds", audience: "students" });
    expect(reply.brief.keyPoints).toHaveLength(3);
    expect(reply.alternatives.map((a) => a.title)).toEqual(["The story behind Why the sky is blue", "Why the sky is blue: what most people get wrong"]);
    const ninety = mockBrief(idea("Why the sky is blue", "en", 90)) as { brief: { keyPoints: string[] } };
    expect(ninety.brief.keyPoints).toHaveLength(4);
    const hindi = mockBrief(idea("आसमान नीला क्यों है", "hi")) as { brief: { title: string } };
    expect(hindi.brief.title).toBe("60 सेकंड में आसमान नीला क्यों है");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("from an idea card, the brief keeps the card's title, angle and hook", () => {
    const card = { kind: "card" as const, title: "Gravity explained in 60 seconds", hook: "[Mock] Have you ever noticed Gravity?", angle: "The shortest clear explanation.", keyPoints: ["a", "b", "c"] };
    const reply = mockBrief({ ...idea(""), source: card }) as { brief: { title: string; hook: string; angle: string } };
    expect(reply.brief).toMatchObject({ title: card.title, hook: card.hook, angle: card.angle });
  });

  it("the triggers work for briefs too", async () => {
    await expect(settle(briefIdea(idea("x [mock:refuse]")))).resolves.toMatchObject({ refused: true });
    await expect(settle(briefIdea(idea("x [mock:busy]")))).rejects.toBeInstanceOf(AiBusyError);
  });
});

it("mock mode is refused in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await expect(settle(suggestIdeas(topic("Photosynthesis")))).rejects.toThrow(/AI_PROVIDER=mock is for development only/);
});
