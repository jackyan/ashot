export type CaptureMode = "region" | "window" | "fullscreen" | "scroll";

export type CaptureState =
  | { kind: "Idle" }
  | { kind: "CaptureOverlayActive"; mode: CaptureMode }
  | { kind: "WindowPicking" }
  | { kind: "RegionSelected"; mode: CaptureMode }
  | { kind: "ToolbarReady"; mode: CaptureMode }
  | { kind: "ScrollReady" }
  | { kind: "ScrollingCapturing" }
  | { kind: "Stitching" }
  | { kind: "PreviewEditor" }
  | { kind: "ExportReady" }
  | { kind: "Error"; reason: string };

export type CaptureEvent =
  | { type: "TriggerCapture"; mode: CaptureMode }
  | { type: "SwitchMode"; mode: CaptureMode }
  | { type: "PickWindow" }
  | { type: "SelectRect" }
  | { type: "Esc" }
  | { type: "Confirm" }
  | { type: "Cancel" }
  | { type: "OpenToolbar" }
  | { type: "StartScroll" }
  | { type: "ScrollDetected" }
  | { type: "Stop" }
  | { type: "Space" }
  | { type: "StitchSuccess" }
  | { type: "StitchFail"; reason: string }
  | { type: "Finish" }
  | { type: "ExportDone" };

export function reduceCaptureState(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (state.kind) {
    case "Idle":
      return event.type === "TriggerCapture"
        ? { kind: "CaptureOverlayActive", mode: event.mode }
        : state;
    case "CaptureOverlayActive":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "SwitchMode") {
        if (event.mode === "window") return { kind: "WindowPicking" };
        return { kind: "CaptureOverlayActive", mode: event.mode };
      }
      if (event.type === "PickWindow") return { kind: "RegionSelected", mode: "window" };
      if (event.type === "SelectRect") return { kind: "RegionSelected", mode: state.mode };
      return state;
    case "WindowPicking":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "PickWindow") return { kind: "RegionSelected", mode: "window" };
      if (event.type === "SwitchMode") {
        if (event.mode === "window") return state;
        return { kind: "CaptureOverlayActive", mode: event.mode };
      }
      return state;
    case "RegionSelected":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "OpenToolbar" || event.type === "Confirm") {
        return { kind: "ToolbarReady", mode: state.mode };
      }
      return state;
    case "ToolbarReady":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "StartScroll") return { kind: "ScrollReady" };
      if (event.type === "Confirm") return { kind: "PreviewEditor" };
      return state;
    case "ScrollReady":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "ScrollDetected") return { kind: "ScrollingCapturing" };
      return state;
    case "ScrollingCapturing":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "Stop" || event.type === "Space") return { kind: "Stitching" };
      return state;
    case "Stitching":
      if (event.type === "StitchSuccess") return { kind: "PreviewEditor" };
      if (event.type === "StitchFail") return { kind: "Error", reason: event.reason };
      return state;
    case "PreviewEditor":
      if (event.type === "Esc" || event.type === "Cancel") return { kind: "Idle" };
      if (event.type === "Finish") return { kind: "ExportReady" };
      return state;
    case "ExportReady":
      return event.type === "ExportDone" ? { kind: "Idle" } : state;
    case "Error":
      return event.type === "Esc" || event.type === "Cancel" ? { kind: "Idle" } : state;
    default:
      return state;
  }
}
