import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));

import { GET as getMe } from "@/app/api/v1/me/route";
import { GET, PATCH } from "@/app/api/v1/me/profile/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { getOrCreateProfile, isValidTimeZone, updateProfile } from "./profiles";
import { hasAnyProject } from "./projects";

const ME = "6ad20f12aa355a5a9f3db9cb";
const APP = "http://localhost:3000";
const user = (over: Record<string, unknown> = {}) => ({ id: ME, name: "Asha", email: "asha@example.com", emailVerified: true, image: null, createdAt: new Date(), ...over });

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections();
  sessionUser.mockReset().mockResolvedValue(user());
  vi.stubEnv("BETTER_AUTH_URL", APP);
});

const patch = (body: unknown, headers: Record<string, string> = {}) =>
  PATCH(new Request(`${APP}/api/v1/me/profile`, { method: "PATCH", headers: { origin: APP, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

describe("updateProfile", () => {
  it("changes the given fields, trims the name and returns the profile", async () => {
    await getOrCreateProfile(ME, "Asha");
    const p = await updateProfile(ME, { displayName: "  Asha Rao  ", defaultLanguage: "hi", defaultBoardOrExam: "cbse" });
    expect(p).toMatchObject({ displayName: "Asha Rao", defaultLanguage: "hi", defaultBoardOrExam: "cbse", defaultLengthPreset: 60, role: "user" });
  });

  it("creates the profile first if it is missing, so the save isn't lost", async () => {
    const p = await updateProfile(ME, { defaultVoiceGender: "male" }, "Asha");
    expect(p).toMatchObject({ displayName: "Asha", defaultVoiceGender: "male", defaultAudience: "students" });
  });

  it("knows real time zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("accepts only IANA names in their real spelling, never offsets, other casings or Etc zones", () => {
    // Intl itself accepts all of these, so they used to be stored as sent.
    for (const tz of ["+05:30", "-08:00", "utc", "asia/kolkata", "ASIA/KOLKATA", "Etc/GMT-5", "GMT"]) expect(isValidTimeZone(tz), tz).toBe(false);
  });

  it("saves in one step even when the profile doesn't exist yet: defaults plus the changes", async () => {
    const p = await updateProfile(ME, { defaultLanguage: "hi", timezone: "Asia/Dubai" }, "Asha");
    expect(p).toMatchObject({ userId: ME, displayName: "Asha", defaultLanguage: "hi", timezone: "Asia/Dubai", defaultLengthPreset: 60, role: "user" });
    expect(await testMongo.db.collection("profiles").countDocuments({ userId: ME })).toBe(1);
    expect((await updateProfile(ME, { displayName: "  Asha M  " })).displayName).toBe("Asha M");
  });
});

describe("PATCH /api/v1/me/profile", () => {
  it("saves any subset of the defaults and returns the whole Profile", async () => {
    const res = await patch({ defaultLanguage: "hi", defaultLengthPreset: 90, defaultAudience: "college", defaultBoardOrExam: "jee", timezone: "Asia/Dubai", emailNotifications: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["about", "defaultAudience", "defaultBoardOrExam", "defaultLanguage", "defaultLengthPreset", "defaultStyleId", "defaultVoiceGender", "displayName", "emailNotifications", "onboardingCompleted", "timezone", "updatedAt"].sort(),
    );
    expect(body).toMatchObject({ defaultLanguage: "hi", defaultLengthPreset: 90, defaultAudience: "college", defaultBoardOrExam: "jee", timezone: "Asia/Dubai", emailNotifications: false });
  });

  it("is what GET /api/v1/me shows afterwards, and new projects pick it up", async () => {
    await patch({ defaultVoiceGender: "male", defaultBoardOrExam: null });
    const me = await (await getMe(new Request(`${APP}/api/v1/me`))).json();
    expect(me.profile).toMatchObject({ defaultVoiceGender: "male", defaultBoardOrExam: null });
  });

  it("allows an empty display name and counts emoji as one character", async () => {
    expect((await patch({ displayName: "" })).status).toBe(200);
    expect((await patch({ displayName: "🙂".repeat(60) })).status).toBe(200);
    expect((await patch({ displayName: "x".repeat(61) })).status).toBe(400);
  });

  it.each([
    [{}],
    [{ defaultLanguage: "fr" }],
    [{ defaultLengthPreset: 75 }],
    [{ defaultVoiceGender: "robot" }],
    [{ defaultAudience: "toddlers" }],
    [{ defaultBoardOrExam: "sat" }],
    [{ timezone: "Mars/Olympus" }],
    [{ timezone: "+05:30" }],
    [{ timezone: "utc" }],
    [{ emailNotifications: "yes" }],
    [{ role: "admin" }],
    [{ defaultStyleId: "neon" }],
  ])("rejects %j with 400 and changes nothing", async (body) => {
    await getOrCreateProfile(ME, "Asha");
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    expect(await testMongo.db.collection("profiles").findOne({ userId: ME })).toMatchObject({ role: "user", defaultLanguage: "en", defaultStyleId: "midnight" });
  });

  it("is protected like every write: a session and our Origin (an unverified email is fine since 2026-10-20)", async () => {
    expect((await patch({ defaultLanguage: "hi" }, { origin: "https://evil.example" })).status).toBe(403);
    sessionUser.mockResolvedValue(user({ emailVerified: false }));
    expect((await patch({ defaultLanguage: "hi" })).status).toBe(200);
    sessionUser.mockResolvedValue(null);
    expect((await patch({ defaultLanguage: "hi" })).status).toBe(401);
    expect(await testMongo.db.collection("profiles").countDocuments({ defaultLanguage: "hi" })).toBe(1); // only the signed-in save
  });

  it("answers GET with 405 (the profile comes with GET /api/v1/me)", async () => {
    const res = await GET(new Request(`${APP}/api/v1/me/profile`));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("PATCH");
  });
});

describe("onboarding (F1.12)", () => {
  it("starts not done, and onboardingCompleted: true records when", async () => {
    const before = await (await getMe(new Request(`${APP}/api/v1/me`))).json();
    expect(before.profile).toMatchObject({ onboardingCompleted: false, about: null });
    const res = await patch({ onboardingCompleted: true });
    expect(res.status).toBe(200);
    expect((await res.json()).onboardingCompleted).toBe(true);
    expect((await testMongo.db.collection("profiles").findOne({ userId: ME }))!.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("saves the language and the 'what do you teach' answer with it (Start creating)", async () => {
    const body = await (await patch({ defaultLanguage: "hi", about: "  Class 9 science  ", onboardingCompleted: true })).json();
    expect(body).toMatchObject({ defaultLanguage: "hi", about: "Class 9 science", onboardingCompleted: true });
  });

  it("clears the answer with an empty string or null, and limits it to 200 characters (emoji count once)", async () => {
    await patch({ about: "History" });
    expect((await (await patch({ about: "" })).json()).about).toBeNull();
    await patch({ about: "History" });
    expect((await (await patch({ about: null })).json()).about).toBeNull();
    expect((await patch({ about: "📚".repeat(200) })).status).toBe(200);
    expect((await patch({ about: "x".repeat(201) })).status).toBe(400);
  });

  it("can't be undone or set to anything but true", async () => {
    for (const value of [false, "yes", 1]) expect((await patch({ onboardingCompleted: value })).status, String(value)).toBe(400);
  });

  it("records when onboarding was finished only the first time (a repeat or double-click keeps it)", async () => {
    await patch({ onboardingCompleted: true });
    const first = (await testMongo.db.collection("profiles").findOne({ userId: ME }))!.onboardingCompletedAt as Date;
    await new Promise((r) => setTimeout(r, 5));
    const again = await (await patch({ about: "History", onboardingCompleted: true })).json();
    expect(again).toMatchObject({ about: "History", onboardingCompleted: true });
    expect((await testMongo.db.collection("profiles").findOne({ userId: ME }))!.onboardingCompletedAt).toEqual(first);
  });

  it("finishes onboarding in the same save that creates a missing profile", async () => {
    const p = await updateProfile(ME, { onboardingCompleted: true }, "Asha");
    expect(p.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(p).toMatchObject({ displayName: "Asha", role: "user" });
  });
});

describe("hasAnyProject (who sees the Welcome screen)", () => {
  it("is false for a new user and true once they have made a project, even a deleted one", async () => {
    expect(await hasAnyProject(ME)).toBe(false);
    await testMongo.db.collection("projects").insertOne({ userId: ME, deletedAt: new Date() }, { bypassDocumentValidation: true });
    expect(await hasAnyProject(ME)).toBe(true);
    expect(await hasAnyProject("6ad2130caa355a5a9f3db9d6")).toBe(false);
  });
});
