import { useState, useEffect, useCallback, useRef } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/useI18n";
import { CAPTURE_SHORTCUT_ID, DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import type { KeyboardShortcut } from "@/lib/shortcuts";
import type { HotkeyHealthSnapshot } from "@/lib/hotkey-health";

export type { KeyboardShortcut };

interface KeyboardShortcutManagerProps {
  shortcuts?: KeyboardShortcut[];
  health?: HotkeyHealthSnapshot;
  onShortcutsChange?: (shortcuts: KeyboardShortcut[]) => void;
}

function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, "⌘")
    .replace(/Command/g, "⌘")
    .replace(/Control/g, "⌃")
    .replace(/Shift/g, "⇧")
    .replace(/Alt/g, "⌥")
    .replace(/Option/g, "⌥")
    .replace(/\+/g, "");
}

function keyEventToShortcut(e: KeyboardEvent): string | null {
  const parts: string[] = [];

  if (e.metaKey) parts.push("Command");
  if (e.ctrlKey) parts.push("Control");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta", "Command"].includes(key)) {
    return null;
  }
  if (parts.length === 0) {
    return null;
  }

  let keyName = key.toUpperCase();
  if (key === " ") keyName = "Space";
  else if (key === "ArrowUp") keyName = "Up";
  else if (key === "ArrowDown") keyName = "Down";
  else if (key === "ArrowLeft") keyName = "Left";
  else if (key === "ArrowRight") keyName = "Right";
  else if (key === "Escape") keyName = "Escape";
  else if (key === "Enter") keyName = "Enter";
  else if (key === "Tab") keyName = "Tab";
  else if (key === "Backspace") keyName = "Backspace";
  else if (key === "Delete") keyName = "Delete";
  else if (key.length === 1) keyName = key.toUpperCase();
  else if (key.startsWith("F") && !Number.isNaN(parseInt(key.slice(1), 10))) keyName = key;

  parts.push(keyName);
  return parts.join("+");
}

function normalizeShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .join("+");
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

function isReservedMacScreenshotShortcut(shortcut: string): boolean {
  if (!isMacPlatform()) return false;
  const segments = normalizeShortcut(shortcut).split("+").filter(Boolean);
  const segmentSet = new Set(segments);
  if (segmentSet.size !== 3) return false;

  const hasCommand = segmentSet.has("command") || segmentSet.has("commandorcontrol");
  const hasShift = segmentSet.has("shift");
  const hasScreenshotKey =
    segmentSet.has("3") ||
    segmentSet.has("4") ||
    segmentSet.has("5") ||
    segmentSet.has("digit3") ||
    segmentSet.has("digit4") ||
    segmentSet.has("digit5");

  return hasCommand && hasShift && hasScreenshotKey;
}

function getCaptureShortcutFromList(shortcuts: KeyboardShortcut[]) {
  return shortcuts.find((shortcut) => shortcut.id === CAPTURE_SHORTCUT_ID) ?? DEFAULT_SHORTCUTS[0];
}

export function KeyboardShortcutManager({ shortcuts: externalShortcuts, health, onShortcutsChange }: KeyboardShortcutManagerProps) {
  const { t } = useI18n();
  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>(externalShortcuts ?? DEFAULT_SHORTCUTS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recordedShortcut, setRecordedShortcut] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const recordingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setShortcuts(externalShortcuts ?? DEFAULT_SHORTCUTS);
  }, [externalShortcuts]);

  const saveShortcuts = useCallback(async (newShortcuts: KeyboardShortcut[]) => {
    try {
      const store = await Store.load("settings.json");
      await store.set("keyboardShortcuts", newShortcuts);
      await store.save();
      onShortcutsChange?.(newShortcuts);
    } catch (err) {
      console.error("Failed to save shortcuts:", err);
      toast.error(t("preferences.toast.saveFailed"));
    }
  }, [onShortcutsChange, t]);

  useEffect(() => {
    if (!isRecording || !editingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setIsRecording(false);
        setEditingId(null);
        setRecordedShortcut(null);
        setShortcutError(null);
        return;
      }

      const shortcut = keyEventToShortcut(e);
      if (shortcut) {
        setRecordedShortcut(shortcut);
        setShortcutError(null);
      }
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!recordedShortcut || !editingId) return;

      if (isReservedMacScreenshotShortcut(recordedShortcut)) {
        const message = t("preferences.toast.shortcutReserved", {
          shortcut: formatShortcut(recordedShortcut),
        });
        setShortcutError(message);
        toast.error(t("preferences.toast.shortcutReservedTitle"), {
          description: message,
        });
        setRecordedShortcut(null);
        return;
      }

      const newShortcuts = shortcuts.map((s) =>
        s.id === editingId ? { ...s, shortcut: recordedShortcut } : s,
      );
      setShortcuts(newShortcuts);
      await saveShortcuts(newShortcuts);
      toast.success(t("preferences.toast.shortcutUpdated"));

      setIsRecording(false);
      setEditingId(null);
      setRecordedShortcut(null);
      setShortcutError(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [editingId, isRecording, recordedShortcut, saveShortcuts, shortcuts, t]);

  const handleStartRecording = useCallback((shortcut: KeyboardShortcut) => {
    setEditingId(shortcut.id);
    setRecordedShortcut(null);
    setIsRecording(true);
    setShortcutError(null);
    setTimeout(() => recordingRef.current?.focus(), 0);
  }, []);

  const handleCancelRecording = useCallback(() => {
    setIsRecording(false);
    setEditingId(null);
    setRecordedShortcut(null);
    setShortcutError(null);
  }, []);

  const handleToggle = useCallback(async (id: string) => {
    const newShortcuts = shortcuts.map((shortcut) =>
      shortcut.id === id ? { ...shortcut, enabled: !shortcut.enabled } : shortcut,
    );
    const toggled = newShortcuts.find((shortcut) => shortcut.id === id);

    if (toggled?.enabled && isReservedMacScreenshotShortcut(toggled.shortcut)) {
      const message = t("preferences.toast.shortcutReserved", {
        shortcut: formatShortcut(toggled.shortcut),
      });
      setShortcutError(message);
      toast.error(t("preferences.toast.shortcutReservedTitle"), {
        description: message,
      });
      return;
    }

    setShortcutError(null);
    setShortcuts(newShortcuts);
    await saveShortcuts(newShortcuts);
  }, [saveShortcuts, shortcuts, t]);

  const captureShortcut = getCaptureShortcutFromList(shortcuts);

  return (
    <div className="space-y-4">
      <label className="text-sm font-medium text-foreground">{t("preferences.shortcuts")}</label>

      {shortcutError && (
        <p className="text-xs text-red-400 text-pretty">{shortcutError}</p>
      )}
      {health && (
        <div
          className={cn(
            "space-y-1 rounded-lg border p-2",
            health.state === "ok"
              ? "border-border bg-secondary"
              : "border-red-500/40 bg-red-500/10",
          )}
        >
          <p
            className={cn(
              "text-xs font-medium",
              health.state === "ok" ? "text-foreground" : "text-red-300",
            )}
          >
            {t("preferences.shortcuts.healthTitle")}
          </p>
          <p
            className={cn(
              "text-xs",
              health.state === "ok" ? "text-muted-foreground" : "text-red-300",
            )}
          >
            {t("preferences.shortcuts.healthCounts", {
              enabled: String(health.enabledCount),
              registered: String(health.registeredCount),
            })}
          </p>
          {health.state !== "ok" && (
            <p className="text-xs text-red-300 text-pretty">
              {health.firstIssue?.message ?? (
                health.state === "no_enabled_shortcuts"
                  ? t("preferences.shortcuts.noneEnabled")
                  : t("common.unknown")
              )}
            </p>
          )}
        </div>
      )}

      <Card className="bg-secondary border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editingId === captureShortcut.id && isRecording ? (
                <div className="flex items-center gap-2">
                  <button
                    ref={recordingRef}
                    className="flex-1 px-2 py-1 bg-card border-2 border-blue-500 rounded text-card-foreground text-sm focus:outline-none animate-pulse text-left"
                    autoFocus
                  >
                    {recordedShortcut ? formatShortcut(recordedShortcut) : t("preferences.shortcuts.recording")}
                  </button>
                  <Button variant="cta" size="lg" onClick={handleCancelRecording}>
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-foreground flex-1">{captureShortcut.action}</span>
                  <button
                    onClick={() => handleStartRecording(captureShortcut)}
                    className="px-2 py-1 bg-card border border-border rounded text-foreground font-mono text-xs tabular-nums hover:bg-secondary hover:border-ring transition-colors"
                    title={t("preferences.shortcuts.recordHint")}
                  >
                    {formatShortcut(captureShortcut.shortcut)}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleToggle(captureShortcut.id)}
                className={cn(
                  "text-xs",
                  captureShortcut.enabled
                    ? "text-green-400 hover:text-green-300"
                    : "text-foreground hover:text-muted-foreground",
                )}
              >
                {captureShortcut.enabled ? t("preferences.shortcuts.enabled") : t("preferences.shortcuts.disabled")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
