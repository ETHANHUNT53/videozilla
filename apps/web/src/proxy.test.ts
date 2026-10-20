import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSession = vi.hoisted(() => vi.fn());
const needsWelcome = vi.hoisted(() => vi.fn());
vi.mock("./server/auth", () => ({ readSession }));
vi.mock("./server/onboarding", () => ({ needsWelcome }));

import { proxy } from "./proxy";

const APP = "http://localhost:3000";
const SESSION = "better-auth.session_token";
const verified = { user: { id: "6ad20f12aa355a5a9f3db9cb", emailVerified: true } };

const get = (path: string, cookies: Record<string, string> = {}) =>
  new NextRequest(`${APP}${path}`, { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } });

/** The "no Welcome needed" cookie the proxy set on a response, if any. */
const doneCookie = (res: Response) => res.headers.get("set-cookie")?.match(/vz_welcome_done=([^;]+)/)?.[1];

beforeEach(() => {
  readSession.mockReset().mockResolvedValue(verified);
  needsWelcome.mockReset().mockResolvedValue(false);
});

describe("proxy: Welcome redirect for the Library (F1.12)", () => {
  it("sends a first-time user to /welcome with an HTTP redirect", async () => {
    needsWelcome.mockResolvedValue(true);
    const res = await proxy(get("/library", { [SESSION]: "tok-1.sig" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${APP}/welcome`);
    expect(doneCookie(res)).toBeUndefined();
  });

  it("checks the database once per session, then remembers the answer in a cookie (prefetches stay cheap)", async () => {
    const first = await proxy(get("/library", { [SESSION]: "tok-1.sig" }));
    expect(first.headers.get("location")).toBeNull();
    const tag = doneCookie(first);
    expect(tag).toBeTruthy();
    expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(first.headers.get("set-cookie")).toMatch(/Path=\/library/i);

    readSession.mockClear();
    needsWelcome.mockClear();
    for (let i = 0; i < 3; i++) await proxy(get("/library", { [SESSION]: "tok-1.sig", vz_welcome_done: tag! }));
    expect(readSession).not.toHaveBeenCalled();
    expect(needsWelcome).not.toHaveBeenCalled();
  });

  it("checks again for another session in the same browser (the cookie is bound to the session)", async () => {
    const tag = doneCookie(await proxy(get("/library", { [SESSION]: "tok-1.sig" })));
    needsWelcome.mockResolvedValue(true); // a new user signed in on this browser
    const res = await proxy(get("/library", { [SESSION]: "tok-2.sig", vz_welcome_done: tag! }));
    expect(res.headers.get("location")).toBe(`${APP}/welcome`);
  });

  it("does nothing (and remembers nothing) for a stale session", async () => {
    readSession.mockResolvedValue(null);
    const res = await proxy(get("/library", { [SESSION]: "tok-1.sig" }));
    expect(res.headers.get("location")).toBeNull();
    expect(doneCookie(res)).toBeUndefined();
    expect(needsWelcome).not.toHaveBeenCalled();
  });

  it("an unverified user gets Welcome like anyone (no email verification since 2026-10-20)", async () => {
    readSession.mockResolvedValue({ user: { ...verified.user, emailVerified: false } });
    needsWelcome.mockResolvedValue(true);
    const res = await proxy(get("/library", { [SESSION]: "tok-1.sig" }));
    expect(res.headers.get("location")).toBe(`${APP}/welcome`);
  });

  it("lets the page decide if the check fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    readSession.mockRejectedValue(new Error("db down"));
    const res = await proxy(get("/library", { [SESSION]: "tok-1.sig" }));
    expect(res.headers.get("location")).toBeNull();
    expect(doneCookie(res)).toBeUndefined();
  });

  it("never runs the check for other pages, and still sends signed-out visitors to sign-in", async () => {
    await proxy(get("/settings", { [SESSION]: "tok-1.sig" }));
    await proxy(get("/welcome", { [SESSION]: "tok-1.sig" }));
    expect(readSession).not.toHaveBeenCalled();
    const out = await proxy(get("/library"));
    expect(out.headers.get("location")).toBe(`${APP}/sign-in?next=%2Flibrary`);
  });
});
