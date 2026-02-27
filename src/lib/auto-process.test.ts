import { beforeEach, describe, expect, it, vi } from "vitest";
import { processScreenshotWithDefaultBackground } from "./auto-process";
import { Store } from "@tauri-apps/plugin-store";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createHighQualityCanvas } from "./canvas-utils";

vi.mock("./asset-registry", () => ({
  resolveBackgroundPath: vi.fn((value: string) => value),
  getDefaultBackgroundPath: vi.fn(() => "/default-bg.png"),
}));

vi.mock("./canvas-utils", () => ({
  createHighQualityCanvas: vi.fn(),
}));

class MockImage {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public crossOrigin = "";
  public width = 1200;
  public height = 800;

  private _src = "";
  set src(value: string) {
    this._src = value;
    if (value.includes("hang://")) {
      return;
    }
    if (value.includes("fail://") || value.includes("fail-load")) {
      queueMicrotask(() => {
        this.onerror?.();
      });
      return;
    }
    queueMicrotask(() => {
      this.onload?.();
    });
  }

  get src() {
    return this._src;
  }
}

class MockFileReader {
  public result: string | null = null;
  public onloadend: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  readAsDataURL() {
    this.result = "data:image/png;base64,mock";
    queueMicrotask(() => {
      this.onloadend?.();
    });
  }
}

describe("processScreenshotWithDefaultBackground", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    vi.mocked(Store.load).mockResolvedValue({
      get: vi.fn(async (key: string) => {
        if (key === "defaultBackgroundType") return "image";
        if (key === "defaultBackgroundImage") return "/background.png";
        if (key === "defaultCustomColor") return "#667eea";
        return null;
      }),
      set: vi.fn(),
      save: vi.fn(),
    } as never);

    vi.mocked(convertFileSrc).mockImplementation((path: string) => `asset://${path}`);
    vi.mocked(createHighQualityCanvas).mockReturnValue({
      toBlob: (callback: BlobCallback) => callback(new Blob(["ok"], { type: "image/png" })),
    } as HTMLCanvasElement);

    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("FileReader", MockFileReader);
  });

  it("resolves processed image data url for valid screenshot", async () => {
    const result = await processScreenshotWithDefaultBackground("/tmp/screenshot.png");
    expect(result).toBe("data:image/png;base64,mock");
    expect(createHighQualityCanvas).toHaveBeenCalledTimes(1);
  });

  it("rejects when screenshot image fails to load", async () => {
    vi.mocked(convertFileSrc).mockImplementationOnce(() => "fail://bad-source");
    await expect(
      processScreenshotWithDefaultBackground("/tmp/fail-load.png"),
    ).rejects.toThrow(/Failed to load screenshot image/i);
  });

  it("rejects on screenshot load timeout instead of hanging", async () => {
    vi.useFakeTimers();
    vi.mocked(convertFileSrc).mockImplementationOnce(() => "hang://never-loads");

    const pending = processScreenshotWithDefaultBackground("/tmp/slow.png");
    const assertion = expect(pending).rejects.toThrow(/Timed out loading screenshot image/i);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });
});
