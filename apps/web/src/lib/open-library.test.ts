import { describe, expect, it, vi } from "vitest";
import { openLibrary } from "./open-library";

describe("openLibrary (after the Welcome screen)", () => {
  it("is a full page load of /library that replaces Welcome in the history (no client-side router cache)", () => {
    const replace = vi.fn();
    openLibrary({ replace });
    expect(replace).toHaveBeenCalledWith("/library");
  });
});
