import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "./errors";

const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("./session", () => ({ sessionUser }));

import { apiRoute, created, methodNotAllowed } from "./handler";

const APP = "http://localhost:3000";
const USER = { id: "6ad20f12aa355a5a9f3db9cb", name: "Asha", email: "asha@example.com", emailVerified: true, image: null, createdAt: new Date() };

function request(method: string, path = "/api/v1/things", init: { body?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (method !== "GET" && !headers.has("origin")) headers.set("origin", APP);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`${APP}${path}`, { method, headers, body: init.body });
}

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

async function error(res: Response) {
  return ((await res.json()) as { error: { code: string; details: { field?: string }[]; requestId: string; message: string; retryable: boolean } }).error;
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  sessionUser.mockReset().mockResolvedValue(USER);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiRoute: responses", () => {
  it("returns handler data as JSON with a request id and no-store caching", async () => {
    const route = apiRoute({}, async ({ user }) => ({ hello: user.name }));
    const res = await route(request("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "Asha" });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("echoes the client's request id, also inside error bodies", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await apiRoute({}, async () => ({}))(request("GET", "/x", { headers: { "x-request-id": "trace-42" } }));
    expect(res.headers.get("x-request-id")).toBe("trace-42");
    expect((await error(res)).requestId).toBe("trace-42");
  });

  it("passes a Response through and keeps its own headers", async () => {
    const route = apiRoute({}, async () => created({ id: "p1" }, "/api/v1/projects/p1"));
    const res = await route(request("POST", "/api/v1/projects", { body: "{}" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/api/v1/projects/p1");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("maps a thrown ApiError to its status and the standard body", async () => {
    const route = apiRoute({}, async () => {
      throw new ApiError("INVALID_STATE", { details: [{ field: "status", issue: "current status is 'rendering'" }] });
    });
    const res = await route(request("GET"));
    expect(res.status).toBe(409);
    expect(await error(res)).toMatchObject({ code: "INVALID_STATE", retryable: false, details: [{ field: "status" }] });
  });

  it("sends Retry-After when the error has one", async () => {
    const res = await apiRoute({}, async () => {
      throw new ApiError("AI_BUSY", { retryAfterSec: 30 });
    })(request("GET"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("hides unexpected errors behind 500 INTERNAL and logs them with the request id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await apiRoute({}, async () => {
      throw new Error("E11000 duplicate key: secret internals");
    })(request("GET", "/x", { headers: { "x-request-id": "r-1" } }));
    expect(res.status).toBe(500);
    const body = await error(res);
    expect(body).toMatchObject({ code: "INTERNAL", retryable: true });
    expect(JSON.stringify(body)).not.toContain("E11000");
    expect(log.mock.calls[0][0]).toContain("r-1");
  });
});

describe("apiRoute: authentication", () => {
  it("401 without a session", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await apiRoute({}, async () => ({}))(request("GET"));
    expect(res.status).toBe(401);
    expect((await error(res)).code).toBe("UNAUTHENTICATED");
  });

  it("403 for an unverified email, unless the route allows any session", async () => {
    sessionUser.mockResolvedValue({ ...USER, emailVerified: false });
    expect((await apiRoute({}, async () => ({}))(request("GET"))).status).toBe(403);
    expect((await apiRoute({ auth: "session" }, async () => ({ ok: true }))(request("GET"))).status).toBe(200);
  });

  it("lets public routes run without a session", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await apiRoute({ auth: "public" }, async ({ user }) => ({ signedIn: user !== null }))(request("GET"));
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it("does not treat a failing session lookup as signed out on public routes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sessionUser.mockRejectedValue(new Error("connection refused"));
    const res = await apiRoute({ auth: "public" }, async () => ({}))(request("GET"));
    expect(res.status).toBe(500);
    expect((await error(res)).code).toBe("INTERNAL");
  });
});

describe("apiRoute: handler results", () => {
  it("answers 204 with no body when the handler returns nothing", async () => {
    const res = await apiRoute({}, async () => undefined)(request("DELETE"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("adds its headers to a returned Response even when that one's headers are read-only", async () => {
    const res = await apiRoute({}, async () => Response.redirect("http://localhost:3000/library", 303))(request("GET"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/library");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("stops reading a body without Content-Length once it passes the limit", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024;
        if (sent > 1024 * 1024) controller.close();
        else controller.enqueue(new Uint8Array(1024));
      },
    });
    const req = new Request(`${APP}/api/v1/things`, {
      method: "POST",
      headers: { origin: APP, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await apiRoute({ body: z.object({}), maxBodyBytes: 4096 }, async () => ({}))(req);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(16 * 1024);
  });
});

describe("apiRoute: CSRF origin check", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s without our Origin before looking at the session", async (method) => {
    const route = apiRoute({}, async () => ({}));
    const missing = await route(new Request(`${APP}/x`, { method }));
    const foreign = await route(request(method, "/x", { headers: { origin: "https://evil.example" } }));
    expect([missing.status, foreign.status]).toEqual([403, 403]);
    expect((await error(foreign)).code).toBe("ORIGIN_NOT_ALLOWED");
    expect(sessionUser).not.toHaveBeenCalled();
  });

  it("does not need Origin on GET", async () => {
    expect((await apiRoute({}, async () => ({}))(new Request(`${APP}/x`))).status).toBe(200);
  });
});

describe("apiRoute: input validation", () => {
  const body = z.strictObject({ title: z.string().min(1).max(80) });

  it("passes the parsed, trimmed body to the handler", async () => {
    const route = apiRoute({ body }, async ({ body }) => body);
    const res = await route(request("POST", "/x", { body: JSON.stringify({ title: "  Sky  " }) }));
    expect(await res.json()).toEqual({ title: "Sky" });
  });

  it("rejects unknown fields", async () => {
    const res = await apiRoute({ body }, async () => ({}))(request("POST", "/x", { body: JSON.stringify({ title: "Sky", titel: "typo" }) }));
    expect(res.status).toBe(400);
    expect((await error(res)).code).toBe("VALIDATION_FAILED");
  });

  it("rejects bodies that aren't JSON", async () => {
    const route = apiRoute({ body }, async () => ({}));
    expect((await route(request("POST", "/x", { body: "title=Sky", headers: { "content-type": "application/x-www-form-urlencoded" } }))).status).toBe(415);
    const broken = await route(request("POST", "/x", { body: "{title:" }));
    expect(broken.status).toBe(400);
    expect((await error(broken)).details).toEqual([{ field: "body", issue: "isn't valid JSON" }]);
  });

  it("rejects bodies over the limit", async () => {
    const route = apiRoute({ body: z.strictObject({ notes: z.string() }), maxBodyBytes: 100 }, async () => ({}));
    const res = await route(request("POST", "/x", { body: JSON.stringify({ notes: "x".repeat(200) }) }));
    expect(res.status).toBe(413);
  });

  it("treats an empty body as {}", async () => {
    const route = apiRoute({ body: z.strictObject({ title: z.string().optional() }) }, async ({ body }) => body);
    expect(await (await route(request("POST", "/x", { body: "" }))).json()).toEqual({});
  });

  it("validates query and path parameters", async () => {
    const route = apiRoute(
      { query: z.strictObject({ limit: z.coerce.number().int().max(100).default(24) }), params: z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/) }) },
      async ({ query, params }) => ({ query, params }),
    );
    const ok = await route(request("GET", "/x?limit=10"), params({ id: USER.id }));
    expect(await ok.json()).toEqual({ query: { limit: 10 }, params: { id: USER.id } });

    const badQuery = await route(request("GET", "/x?limit=500"), params({ id: USER.id }));
    expect((await error(badQuery)).details[0].field).toBe("limit");
    const badParam = await route(request("GET", "/x"), params({ id: "nope" }));
    expect((await error(badParam)).details[0].field).toBe("id");
  });

  it("checks the session before validating, so signed-out callers learn nothing about the input rules", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await apiRoute({ body }, async () => ({}))(request("POST", "/x", { body: JSON.stringify({ wrong: 1 }) }));
    expect(res.status).toBe(401);
  });
});

describe("methodNotAllowed", () => {
  it("answers the standard 405 body with an Allow header", async () => {
    const res = await methodNotAllowed(["GET"])(request("POST", "/api/v1/me", { body: "{}" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect((await error(res)).code).toBe("METHOD_NOT_ALLOWED");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
