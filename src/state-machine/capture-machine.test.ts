import { describe, expect, it } from "vitest";
import { reduceCaptureState, type CaptureState } from "./capture-machine";

describe("capture machine", () => {
  it("starts capture from idle", () => {
    const state: CaptureState = { kind: "Idle" };
    const next = reduceCaptureState(state, { type: "TriggerCapture", mode: "region" });
    expect(next).toEqual({ kind: "CaptureOverlayActive", mode: "region" });
  });

  it("scroll flow reaches stitching", () => {
    const afterTrigger = reduceCaptureState({ kind: "Idle" }, { type: "TriggerCapture", mode: "scroll" });
    const afterSelect = reduceCaptureState(afterTrigger, { type: "SelectRect" });
    const toolbarReady = reduceCaptureState(afterSelect, { type: "OpenToolbar" });
    const scrollReady = reduceCaptureState(toolbarReady, { type: "StartScroll" });
    const capturing = reduceCaptureState(scrollReady, { type: "ScrollDetected" });
    const stitching = reduceCaptureState(capturing, { type: "Space" });
    expect(stitching).toEqual({ kind: "Stitching" });
  });

  it("error returns to idle on cancel", () => {
    const state: CaptureState = { kind: "Error", reason: "test" };
    const next = reduceCaptureState(state, { type: "Cancel" });
    expect(next).toEqual({ kind: "Idle" });
  });
});
