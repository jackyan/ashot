import { describe, expect, it } from "vitest";
import {
  deriveHotkeyHealth,
  resolveCaptureModeByShortcutId,
  type ShortcutRegistrationIssue,
} from "./hotkey-health";
import type { KeyboardShortcut } from "./shortcuts";

const shortcuts: KeyboardShortcut[] = [
  { id: "capture", action: "Start Capture", shortcut: "CommandOrControl+Alt+Shift+R", enabled: true },
  { id: "legacy-region", action: "Capture Region", shortcut: "CommandOrControl+Shift+2", enabled: true },
];

describe("hotkey health", () => {
  it("resolves capture mode by shortcut id", () => {
    expect(resolveCaptureModeByShortcutId("capture")).toBe("region");
    expect(resolveCaptureModeByShortcutId("unknown")).toBeNull();
  });

  it("reports no-enabled state when capture shortcut is disabled", () => {
    const disabled = shortcuts.map((shortcut) =>
      shortcut.id === "capture" ? { ...shortcut, enabled: false } : shortcut,
    );
    const health = deriveHotkeyHealth(disabled, 0, []);
    expect(health.state).toBe("no_enabled_shortcuts");
    expect(health.enabledCount).toBe(0);
  });

  it("reports unknown id registration state when first issue is unknown id", () => {
    const issues: ShortcutRegistrationIssue[] = [{
      kind: "unknown_shortcut_id",
      message: "Unknown action",
      action: "Broken",
    }];
    const health = deriveHotkeyHealth(shortcuts, 0, issues);
    expect(health.state).toBe("unknown_shortcut_id");
    expect(health.firstIssue?.kind).toBe("unknown_shortcut_id");
  });

  it("reports ok when capture shortcut is registered", () => {
    const health = deriveHotkeyHealth(shortcuts, 1, []);
    expect(health.state).toBe("ok");
    expect(health.enabledCount).toBe(1);
    expect(health.registeredCount).toBe(1);
  });
});
