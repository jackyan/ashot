import { describe, expect, it, vi } from "vitest";
import { ensureScreenPermission } from "./permission-flow";

describe("ensureScreenPermission", () => {
  it("returns granted when permission is already available", async () => {
    const result = await ensureScreenPermission({
      checkPermission: vi.fn().mockResolvedValue(true),
      requestPermission: vi.fn(),
    });

    expect(result).toBe("granted");
  });

  it("returns granted when request flow succeeds", async () => {
    const checkPermission = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const requestPermission = vi.fn().mockResolvedValue(true);

    const result = await ensureScreenPermission({
      checkPermission,
      requestPermission,
    });

    expect(result).toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("returns denied when permission is still unavailable after request", async () => {
    const checkPermission = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const requestPermission = vi.fn().mockResolvedValue(false);

    const result = await ensureScreenPermission({
      checkPermission,
      requestPermission,
    });

    expect(result).toBe("denied");
  });

  it("returns error when request throws", async () => {
    const result = await ensureScreenPermission({
      checkPermission: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockRejectedValue(new Error("boom")),
    });

    expect(result).toBe("error");
  });
});

