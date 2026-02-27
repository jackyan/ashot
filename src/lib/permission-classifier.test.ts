import { describe, expect, it } from "vitest";
import { classifyCaptureError } from "./capture-errors";

describe("capture error classifier", () => {
  it("maps display-image creation failure to permission error", () => {
    const kind = classifyCaptureError("command_failed:Screen Recording check failed (exit code: 1): could not create image from display");
    expect(kind).toBe("permission");
  });

  it("keeps cancelled semantics", () => {
    expect(classifyCaptureError("cancelled:Screenshot was cancelled or failed")).toBe("cancelled");
  });

  it("maps explicit permission-denied messages to permission error", () => {
    expect(classifyCaptureError("permission:Screen Recording permission not granted")).toBe(
      "permission",
    );
  });
});
