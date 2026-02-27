export type ScrollSessionState =
  | "idle"
  | "selecting"
  | "confirming"
  | "capturing"
  | "stitching"
  | "previewing"
  | "failed";

export type StitchResult = {
  path: string;
  totalFrames: number;
  usedFrames: number;
  skippedFrames: number;
  finalHeight: number;
};

export type ScrollPollResult = {
  state: "unchanged" | "scrolling" | "captured";
  framePath: string | null;
  frameCount: number;
};

export const SCROLL_SESSION_TIMEOUT_MS = 120_000;

export function shouldAutoCancelScrollSession(
  lastActivityAt: number,
  now = Date.now(),
  timeoutMs = SCROLL_SESSION_TIMEOUT_MS,
) {
  return now - lastActivityAt >= timeoutMs;
}
