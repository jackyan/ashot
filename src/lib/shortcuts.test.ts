import { describe, expect, it } from "vitest";
import {
  CAPTURE_SHORTCUT_ID,
  DEFAULT_SHORTCUTS,
  LEGACY_DEFAULT_SHORTCUTS,
  hydrateShortcuts,
  type KeyboardShortcut,
} from "./shortcuts";

function clone(shortcuts: KeyboardShortcut[]) {
  return shortcuts.map((shortcut) => ({ ...shortcut }));
}

describe("shortcut hydration", () => {
  it("returns default capture shortcut when settings are empty", () => {
    const result = hydrateShortcuts(undefined, { shortcutSchemaVersion: 4 });

    expect(result.changed).toBe(false);
    expect(result.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it("unifies legacy 5 capture shortcuts into a single capture shortcut", () => {
    const result = hydrateShortcuts(clone(LEGACY_DEFAULT_SHORTCUTS), {
      shortcutSchemaVersion: 0,
      unifiedAlreadyApplied: false,
    });

    expect(result.changed).toBe(true);
    expect(result.appliedUnification).toBe(true);
    expect(result.shortcuts).toHaveLength(1);
    expect(result.shortcuts[0]).toEqual({
      id: CAPTURE_SHORTCUT_ID,
      action: "Start Capture",
      shortcut: "CommandOrControl+Shift+2",
      enabled: true,
    });
  });

  it("keeps existing single capture shortcut unchanged", () => {
    const saved: KeyboardShortcut[] = [
      {
        id: CAPTURE_SHORTCUT_ID,
        action: "My Capture",
        shortcut: "CommandOrControl+Alt+Shift+Y",
        enabled: true,
      },
    ];

    const result = hydrateShortcuts(saved, {
      shortcutSchemaVersion: 4,
      unifiedAlreadyApplied: true,
    });

    expect(result.changed).toBe(false);
    expect(result.appliedUnification).toBe(false);
    expect(result.shortcuts[0]).toEqual({
      id: CAPTURE_SHORTCUT_ID,
      action: "My Capture",
      shortcut: "CommandOrControl+Alt+Shift+Y",
      enabled: true,
    });
  });

  it("prefers first enabled legacy shortcut by priority when unifying", () => {
    const saved = clone(LEGACY_DEFAULT_SHORTCUTS).map((item) => ({ ...item, enabled: false }));
    const scroll = saved.find((item) => item.id === "scroll");
    if (!scroll) throw new Error("Missing scroll shortcut in test fixture");
    scroll.enabled = true;
    scroll.shortcut = "CommandOrControl+Alt+Shift+S";

    const result = hydrateShortcuts(saved, {
      shortcutSchemaVersion: 0,
      unifiedAlreadyApplied: false,
    });

    expect(result.shortcuts[0].shortcut).toBe("CommandOrControl+Alt+Shift+S");
    expect(result.shortcuts[0].enabled).toBe(true);
  });

  it("applies one-time safety enable when capture shortcut is disabled", () => {
    const saved: KeyboardShortcut[] = [
      {
        id: CAPTURE_SHORTCUT_ID,
        action: "Start Capture",
        shortcut: "CommandOrControl+Alt+Shift+R",
        enabled: false,
      },
    ];

    const result = hydrateShortcuts(saved, {
      shortcutSchemaVersion: 4,
      unifiedAlreadyApplied: true,
      safetyAlreadyApplied: false,
    });

    expect(result.appliedSafety).toBe(true);
    expect(result.shortcuts[0].enabled).toBe(true);
  });

  it("keeps non-legacy custom shortcuts during unification", () => {
    const saved: KeyboardShortcut[] = [
      ...clone(LEGACY_DEFAULT_SHORTCUTS),
      {
        id: "custom-share",
        action: "Share",
        shortcut: "CommandOrControl+Alt+Shift+K",
        enabled: false,
      },
    ];

    const result = hydrateShortcuts(saved, {
      shortcutSchemaVersion: 0,
      unifiedAlreadyApplied: false,
    });

    expect(result.shortcuts.find((item) => item.id === "custom-share")?.shortcut).toBe(
      "CommandOrControl+Alt+Shift+K",
    );
  });
});
