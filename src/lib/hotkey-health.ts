import type { KeyboardShortcut } from "./shortcuts";
import { CAPTURE_SHORTCUT_ID } from "./shortcuts";

export type CaptureMode = "region";

export type ShortcutRegistrationIssueKind =
  | "duplicate"
  | "register_failed"
  | "unknown_shortcut_id";

export type ShortcutHealthState =
  | "ok"
  | "no_enabled_shortcuts"
  | "registration_failed"
  | "unknown_shortcut_id";

export interface ShortcutRegistrationIssue {
  kind: ShortcutRegistrationIssueKind;
  message: string;
  shortcut?: string;
  action?: string;
  reason?: string;
  existingAction?: string;
}

export interface HotkeyHealthSnapshot {
  state: ShortcutHealthState;
  enabledCount: number;
  registeredCount: number;
  firstIssue: ShortcutRegistrationIssue | null;
}

export function resolveCaptureModeByShortcutId(id: string): CaptureMode | null {
  return id === CAPTURE_SHORTCUT_ID ? "region" : null;
}

export function deriveHotkeyHealth(
  shortcuts: KeyboardShortcut[],
  registeredCount: number,
  issues: ShortcutRegistrationIssue[],
): HotkeyHealthSnapshot {
  const enabledCount = shortcuts.filter(
    (shortcut) => shortcut.id === CAPTURE_SHORTCUT_ID && shortcut.enabled,
  ).length;
  const firstIssue = issues[0] ?? null;

  if (enabledCount === 0) {
    return {
      state: "no_enabled_shortcuts",
      enabledCount,
      registeredCount,
      firstIssue,
    };
  }

  if (firstIssue) {
    return {
      state:
        firstIssue.kind === "unknown_shortcut_id"
          ? "unknown_shortcut_id"
          : "registration_failed",
      enabledCount,
      registeredCount,
      firstIssue,
    };
  }

  return {
    state: "ok",
    enabledCount,
    registeredCount,
    firstIssue: null,
  };
}
