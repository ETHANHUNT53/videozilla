import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElevenLabsTTS } from "./elevenlabs";

const FEMALE = "female-voice-id";
const MALE = "male-voice-id";

/** A with-timestamps response that says "Hi there" (timings in seconds, per character). */
const SPOKEN = {
  audio_base64: Buffer.from("fake-mp3").toString("base64"),
  alignment: {
    characters: ["H", "i", " ", "t", "h", "e", "r", "e"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6],
  },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Shared by both suites: a temp output folder, the two approved voices, and a mocked API (no real calls). */
let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vz-voice-"));
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_VOICE_FEMALE", FEMALE);
  vi.stubEnv("ELEVENLABS_VOICE_MALE", MALE);
  vi.stubEnv("ELEVENLABS_MODEL", ""); // a model set in the shell must not change the request under test
  fetchMock = vi.fn(async () => json(SPOKEN));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ElevenLabs voice: approved voices only", () => {
  const opts = () => ({ language: "en" as const, outPathNoExt: path.join(dir, "scene-1") });

  const calledVoice = () => String(fetchMock.mock.calls[0][0]).match(/text-to-speech\/([^/]+)\//)?.[1];

  it("uses the female voice by default and the male voice when asked", async () => {
    const tts = createElevenLabsTTS();
    await tts.synthesize("Hi there", opts());
    expect(calledVoice()).toBe(FEMALE);
    fetchMock.mockClear();
    await tts.synthesize("Hi there", { ...opts(), gender: "male" });
    expect(calledVoice()).toBe(MALE);
  });

  it("accepts an explicit voice only if it is one of the two approved voices", async () => {
    const tts = createElevenLabsTTS();
    await tts.synthesize("Hi there", { ...opts(), voice: MALE });
    expect(calledVoice()).toBe(MALE);
    await expect(tts.synthesize("Hi there", { ...opts(), voice: "some-other-voice" })).rejects.toThrow(/not one of the approved voices/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to run when the approved voice for that gender is not configured", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_MALE", "");
    await expect(createElevenLabsTTS().synthesize("Hi", { ...opts(), gender: "male" })).rejects.toThrow("Set ELEVENLABS_VOICE_MALE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains the paid-plan requirement on 402 and never tries another voice", async () => {
    fetchMock.mockResolvedValue(json({ detail: "payment_required" }, 402));
    await expect(createElevenLabsTTS().synthesize("Hi there", opts())).rejects.toThrow(/paid ElevenLabs plan.*no fallback voice/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledVoice()).toBe(FEMALE);
  });

  it("needs an API key", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(() => createElevenLabsTTS()).toThrow("ELEVENLABS_API_KEY missing");
  });
});

describe("ElevenLabs voice: request and timings", () => {
  it("sends the text, model, neighbouring text and speed", async () => {
    await createElevenLabsTTS().synthesize("Hi there", {
      language: "hi",
      outPathNoExt: path.join(dir, "s1"),
      previousText: "Before.",
      nextText: "After.",
      speed: 1.1,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${FEMALE}/with-timestamps`);
    expect(init.headers["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({
      text: "Hi there",
      model_id: "eleven_multilingual_v2",
      previous_text: "Before.",
      next_text: "After.",
      voice_settings: { speed: 1.1 },
    });
  });

  it("leaves out voice settings at normal speed", async () => {
    await createElevenLabsTTS().synthesize("Hi there", { language: "en", outPathNoExt: path.join(dir, "s1"), speed: 1 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).voice_settings).toBeUndefined();
  });

  it("writes the audio and groups character timings into words", async () => {
    const result = await createElevenLabsTTS().synthesize("Hi there", { language: "en", outPathNoExt: path.join(dir, "s1") });
    expect(result.audioPath).toBe(path.join(dir, "s1.mp3"));
    expect(await readFile(result.audioPath, "utf8")).toBe("fake-mp3");
    expect(result.timingSource).toBe("tts");
    expect(result.words).toEqual([
      { text: "Hi", startMs: 0, endMs: 200 },
      { text: "there", startMs: 300, endMs: 600 },
    ]);
    expect(result.durationMs).toBe(750);
  });

  it("falls back to forced alignment when the response has no timings", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ audio_base64: SPOKEN.audio_base64, alignment: null }))
      .mockResolvedValueOnce(json({ words: [{ text: "Hi", start: 0, end: 0.2 }, { text: " ", start: 0.2, end: 0.3 }, { text: "there", start: 0.3, end: 0.6 }] }));
    const result = await createElevenLabsTTS().synthesize("Hi there", { language: "en", outPathNoExt: path.join(dir, "s1") });
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.elevenlabs.io/v1/forced-alignment");
    expect(result.timingSource).toBe("forced_alignment");
    expect(result.words.map((w) => w.text)).toEqual(["Hi", "there"]);
    expect(result.durationMs).toBe(750);
  });

  it("reports other API errors with their status", async () => {
    fetchMock.mockResolvedValue(new Response("quota exceeded", { status: 429 }));
    await expect(createElevenLabsTTS().synthesize("Hi", { language: "en", outPathNoExt: path.join(dir, "s1") })).rejects.toThrow(
      "ElevenLabs TTS failed (429): quota exceeded",
    );
  });
});
