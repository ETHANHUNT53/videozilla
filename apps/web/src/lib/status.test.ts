import { describe, expect, it } from "vitest";
import { timeAgo } from "./status";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");

  it("gives relative labels up to 30 days", () => {
    expect(timeAgo("2026-10-17T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-17T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-10-14T12:00:00Z", now)).toBe("3 d ago");
  });

  it("dates older items in the given time zone, whatever the runtime's zone is", () => {
    // 20:00 UTC on 6 Sept is already 7 Sept in India.
    expect(timeAgo("2026-09-06T20:00:00Z", now, "Asia/Kolkata")).toBe("7 Sept 2026");
    expect(timeAgo("2026-09-06T20:00:00Z", now, "UTC")).toBe("6 Sept 2026");
  });

  it("falls back to India time for an unknown zone name", () => {
    expect(timeAgo("2026-09-06T20:00:00Z", now, "Not/AZone")).toBe("7 Sept 2026");
  });
});
