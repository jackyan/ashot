import { describe, expect, it } from "vitest";
import { SCROLL_SESSION_TIMEOUT_MS, shouldAutoCancelScrollSession } from "./scroll-session";

describe("scroll session timeout", () => {
  it("returns false before timeout threshold", () => {
    const now = 1_000_000;
    const lastActive = now - SCROLL_SESSION_TIMEOUT_MS + 1;
    expect(shouldAutoCancelScrollSession(lastActive, now)).toBe(false);
  });

  it("returns true when timeout threshold is reached", () => {
    const now = 1_000_000;
    const lastActive = now - SCROLL_SESSION_TIMEOUT_MS;
    expect(shouldAutoCancelScrollSession(lastActive, now)).toBe(true);
  });
});
