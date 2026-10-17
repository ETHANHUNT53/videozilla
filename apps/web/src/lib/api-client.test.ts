import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiCall } from "./api-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("apiCall", () => {
  const assign = vi.fn();
  afterEach(() => assign.mockReset());

  const stub = (res: Response | Error) => {
    vi.stubGlobal("window", { location: { pathname: "/library", search: "?filter=drafts", assign } });
    vi.stubGlobal("fetch", vi.fn(async () => (res instanceof Error ? Promise.reject(res) : res)));
  };

  it("sends JSON and returns the data", async () => {
    stub(json({ id: "p1" }, 201));
    const { data } = await apiCall<{ id: string }>("/api/v1/projects", { method: "POST", body: {} });
    expect(data).toEqual({ id: "p1" });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init).toMatchObject({ method: "POST", body: "{}", headers: { "Content-Type": "application/json", Accept: "application/json" } });
  });

  it("turns the standard error body into an ApiClientError", async () => {
    stub(json({ error: { code: "PUBLISH_IN_PROGRESS", message: "Being posted.", details: [{ issue: "x" }] } }, 409));
    await expect(apiCall("/api/v1/projects/p1", { method: "DELETE" })).rejects.toMatchObject({ status: 409, code: "PUBLISH_IN_PROGRESS", message: "Being posted." });
  });

  it("sends a signed-out user to sign-in and back to this page", async () => {
    stub(json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } }, 401));
    await expect(apiCall("/api/v1/projects")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(assign).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent("/library?filter=drafts")}`);
  });

  it("reports a network failure in plain words", async () => {
    stub(new TypeError("Failed to fetch"));
    const err = await apiCall("/api/v1/projects").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe("NETWORK");
  });
});
