import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorActions } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { classifyCaptureError } from "@/lib/capture-errors";
import { processScreenshotWithDefaultBackground } from "@/lib/auto-process";
import {
  ensureScreenPermission as ensureScreenPermissionFlow,
  type PermissionEnsureResult,
} from "@/lib/permission-flow";
import {
  deriveHotkeyHealth,
  resolveCaptureModeByShortcutId,
  type HotkeyHealthSnapshot,
  type ShortcutRegistrationIssue,
} from "@/lib/hotkey-health";
import { hasCompletedOnboarding } from "@/lib/onboarding";
import {
  CAPTURE_SHORTCUT_ID,
  DEFAULT_SHORTCUTS,
  hydrateShortcuts,
  type KeyboardShortcut,
} from "@/lib/shortcuts";
import {
  SCROLL_SESSION_TIMEOUT_MS,
  shouldAutoCancelScrollSession,
  type ScrollPollResult,
  type ScrollSessionState,
  type StitchResult,
} from "@/lib/scroll-session";
import { useI18n } from "@/i18n/useI18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  availableMonitors,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { Store } from "@tauri-apps/plugin-store";
import { Crop, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SettingsIcon } from "./components/SettingsIcon";
import { CaptureOverlay } from "./components/capture/CaptureOverlay";
import {
  SelectionToolbar,
} from "./components/capture/SelectionToolbar";
import { ScrollPreviewPanel } from "./components/scroll/ScrollPreviewPanel";
import { ScrollSessionMiniToolbar } from "./components/scroll/ScrollSessionMiniToolbar";
import { EditorShell } from "./components/editor/EditorShell";
import {
  reduceCaptureState,
  type CaptureEvent,
  type CaptureState,
} from "@/state-machine/capture-machine";
import {
  clampRectToMonitor,
} from "@/ui-workflows/capture-shell/geometry";
import type {
  ActiveMonitorContext,
  CaptureRect,
  CaptureWindowInfo,
  MonitorShot,
} from "@/ui-workflows/capture-shell/types";

const OnboardingFlow = lazy(() =>
  import("./components/onboarding/OnboardingFlow").then((m) => ({ default: m.OnboardingFlow })),
);
const PreferencesPage = lazy(() =>
  import("./components/preferences/PreferencesPage").then((m) => ({ default: m.PreferencesPage })),
);

type AppView = "launcher" | "preferences" | "editing" | "capture";

type SaveImageResponse = {
  path: string;
  copy_warning?: string | null;
};

type ScrollSession = {
  sessionDir: string;
  framesDir: string;
  rect: CaptureRect;
  frames: string[];
};

type ScrollFinishIntent = "save" | "edit" | "copy_only";

const SCROLL_HOTKEYS = {
  save: "CommandOrControl+Shift+S",
  edit: "CommandOrControl+Shift+E",
  copy: "CommandOrControl+Shift+C",
  cancel: "CommandOrControl+Shift+X",
} as const;

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

async function restoreWindowOnScreen(mouseX?: number, mouseY?: number) {
  const appWindow = getCurrentWindow();
  const windowWidth = 1200;
  const windowHeight = 800;

  await appWindow.setDecorations(true);
  await appWindow.setAlwaysOnTop(false);
  await appWindow.setResizable(true);
  await appWindow.setSize(new LogicalSize(windowWidth, windowHeight));
  await invoke("set_main_window_mouse_passthrough", { enabled: false }).catch(() => undefined);

  if (mouseX !== undefined && mouseY !== undefined) {
    try {
      const monitors = await availableMonitors();
      const targetMonitor = monitors.find((monitor) => {
        const scale = monitor.scaleFactor || 1;
        const logicalX = monitor.position.x / scale;
        const logicalY = monitor.position.y / scale;
        const logicalWidth = monitor.size.width / scale;
        const logicalHeight = monitor.size.height / scale;

        return (
          mouseX >= logicalX &&
          mouseX < logicalX + logicalWidth &&
          mouseY >= logicalY &&
          mouseY < logicalY + logicalHeight
        );
      });

      if (targetMonitor) {
        const scale = targetMonitor.scaleFactor || 1;
        const logicalX = targetMonitor.position.x / scale;
        const logicalY = targetMonitor.position.y / scale;
        const logicalWidth = targetMonitor.size.width / scale;
        const logicalHeight = targetMonitor.size.height / scale;

        await appWindow.setPosition(
          new LogicalPosition(
            logicalX + (logicalWidth - windowWidth) / 2,
            logicalY + (logicalHeight - windowHeight) / 2,
          ),
        );
      } else {
        await appWindow.center();
      }
    } catch {
      await appWindow.center();
    }
  } else {
    await appWindow.center();
  }

  await appWindow.show();
  await appWindow.setFocus();
}

async function restoreWindow() {
  await restoreWindowOnScreen();
}

function LoadingFallback() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground">
        <svg
          className="size-5 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <span>Loading...</span>
      </div>
    </div>
  );
}

function isOverlayCaptureState(state: CaptureState) {
  return (
    state.kind === "CaptureOverlayActive" ||
    state.kind === "WindowPicking" ||
    state.kind === "RegionSelected" ||
    state.kind === "ToolbarReady" ||
    state.kind === "ScrollReady" ||
    state.kind === "ScrollingCapturing" ||
    state.kind === "Stitching"
  );
}

function inMonitorLogical(x: number, y: number, monitor: ActiveMonitorContext) {
  return (
    x >= monitor.x &&
    x < monitor.x + monitor.width &&
    y >= monitor.y &&
    y < monitor.y + monitor.height
  );
}

function resolveMonitorBackgroundPath(shots: MonitorShot[], monitor: ActiveMonitorContext): string | null {
  if (!shots.length) return null;

  const scoreShot = (shot: MonitorShot) => {
    const scale = shot.scale_factor || 1;
    const logicalX = shot.x / scale;
    const logicalY = shot.y / scale;
    const logicalWidth = shot.width / scale;
    const logicalHeight = shot.height / scale;

    const dx = Math.abs(logicalX - monitor.x);
    const dy = Math.abs(logicalY - monitor.y);
    const dw = Math.abs(logicalWidth - monitor.width);
    const dh = Math.abs(logicalHeight - monitor.height);
    return dx + dy + dw + dh;
  };

  const best = shots.reduce<{ score: number; shot: MonitorShot | null }>(
    (acc, shot) => {
      const score = scoreShot(shot);
      if (score < acc.score) {
        return { score, shot };
      }
      return acc;
    },
    { score: Number.POSITIVE_INFINITY, shot: null },
  );

  return best.shot?.path ?? null;
}

function App() {
  const { t } = useI18n();

  const [appView, setAppView] = useState<AppView>("launcher");
  const [captureState, setCaptureState] = useState<CaptureState>({ kind: "Idle" });

  const [saveDir, setSaveDir] = useState<string>("");
  const [autoApplyBackground, setAutoApplyBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionError, setIsPermissionError] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [tempScreenshotPath, setTempScreenshotPath] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>(DEFAULT_SHORTCUTS);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [tempDir, setTempDir] = useState<string>("/tmp");

  const [activeMonitor, setActiveMonitor] = useState<ActiveMonitorContext | null>(null);
  const [overlayBackgroundPath, setOverlayBackgroundPath] = useState<string | null>(null);
  const [overlayWindows, setOverlayWindows] = useState<CaptureWindowInfo[]>([]);
  const [selectedRect, setSelectedRect] = useState<CaptureRect | null>(null);

  const [scrollSessionState, setScrollSessionState] = useState<ScrollSessionState>("idle");
  const [scrollFrameCount, setScrollFrameCount] = useState(0);
  const [scrollIsScrolling, setScrollIsScrolling] = useState(false);
  const [scrollPreviewPath, setScrollPreviewPath] = useState<string | null>(null);

  const [hotkeyHealth, setHotkeyHealth] = useState<HotkeyHealthSnapshot>({
    state: "no_enabled_shortcuts",
    enabledCount: 0,
    registeredCount: 0,
    firstIssue: null,
  });

  const settingsRef = useRef({ autoApplyBackground, saveDir, tempDir });
  const registeredShortcutsRef = useRef<Set<string>>(new Set());
  const scrollShortcutsRef = useRef<Set<string>>(new Set());

  const lastCaptureTimeRef = useRef(0);
  const isCapturingRef = useRef(false);
  const isScrollSessionActiveRef = useRef(false);
  const scrollSessionRef = useRef<ScrollSession | null>(null);
  const scrollLastActivityRef = useRef(0);
  const finishScrollCaptureRef = useRef<(intent?: ScrollFinishIntent) => Promise<void>>(async () => undefined);
  const cancelScrollCaptureRef = useRef<(reason?: "user" | "timeout") => Promise<void>>(
    async () => undefined,
  );

  const transitionCaptureState = useCallback((event: CaptureEvent) => {
    setCaptureState((prev) => reduceCaptureState(prev, event));
  }, []);

  useEffect(() => {
    settingsRef.current = { autoApplyBackground, saveDir, tempDir };
  }, [autoApplyBackground, saveDir, tempDir]);

  const unregisterSet = useCallback(async (setRef: { current: Set<string> }) => {
    const shortcutsToUnregister = Array.from(setRef.current);
    if (shortcutsToUnregister.length === 0) return;
    try {
      await unregister(shortcutsToUnregister);
    } catch (unregisterError) {
      console.error("Failed to unregister shortcuts:", unregisterError);
    } finally {
      setRef.current.clear();
    }
  }, []);

  const clearOverlayUiState = useCallback(() => {
    setActiveMonitor(null);
    setOverlayBackgroundPath(null);
    setOverlayWindows([]);
    setSelectedRect(null);
    setScrollSessionState("idle");
    setScrollFrameCount(0);
    setScrollIsScrolling(false);
    setScrollPreviewPath(null);
    setCaptureState({ kind: "Idle" });
  }, []);

  const resetOverlayFlow = useCallback(
    async (restoreMainWindow: boolean, nextView: AppView = "launcher") => {
      clearOverlayUiState();
      isScrollSessionActiveRef.current = false;
      scrollSessionRef.current = null;
      scrollLastActivityRef.current = 0;
      await invoke("set_main_window_mouse_passthrough", { enabled: false }).catch(() => undefined);
      setAppView(nextView);

      if (restoreMainWindow) {
        await restoreWindow();
      }
    },
    [clearOverlayUiState],
  );

  const handleCopyWarning = useCallback(
    (warning?: string | null) => {
      if (!warning) return;
      toast.error(t("app.toast.copyWarn"), {
        description: warning,
        duration: 4500,
      });
    },
    [t],
  );

  const ensureScreenPermission = useCallback(
    async (announceRequest = false): Promise<PermissionEnsureResult> => {
      return ensureScreenPermissionFlow({
        checkPermission: () => invoke<boolean>("check_screen_permission"),
        requestPermission: async () => {
          if (announceRequest) {
            toast(t("app.toast.permissionRequestStarted"), {
              duration: 2500,
            });
          }
          return invoke<boolean>("request_screen_permission");
        },
      });
    },
    [t],
  );

  const handlePermissionRetry = useCallback(async () => {
    const result = await ensureScreenPermission(true);
    if (result === "granted") {
      setError(null);
      setIsPermissionError(false);
      toast.success(t("app.toast.permissionGranted"), { duration: 3000 });
      return;
    }

    setIsPermissionError(true);
    setError(t("app.error.permission"));
    if (result === "denied") {
      toast.error(t("app.toast.permissionStillDenied"), { duration: 3500 });
    } else {
      toast.error(t("app.toast.permissionCheckFailed"), { duration: 3500 });
    }
  }, [ensureScreenPermission, t]);

  const handleOpenScreenRecordingSettings = useCallback(async () => {
    try {
      await invoke("open_screen_recording_settings");
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : String(openError);
      toast.error(t("app.toast.openSettingsFailed"), {
        description: message,
        duration: 4500,
      });
    }
  }, [t]);

  const resolveActiveMonitorByCursor = useCallback(async (): Promise<ActiveMonitorContext> => {
    const monitors = await availableMonitors();
    if (!monitors.length) {
      throw new Error("No monitor found");
    }

    const monitorContexts = monitors.map((monitor, index) => {
      const scaleFactor = monitor.scaleFactor || 1;
      const logicalX = monitor.position.x / scaleFactor;
      const logicalY = monitor.position.y / scaleFactor;
      const logicalWidth = monitor.size.width / scaleFactor;
      const logicalHeight = monitor.size.height / scaleFactor;
      return {
        id: `${monitor.name ?? "display"}-${index}`,
        x: logicalX,
        y: logicalY,
        width: logicalWidth,
        height: logicalHeight,
        scaleFactor,
        label: monitor.name || `${t("app.monitor")} ${index + 1}`,
      } satisfies ActiveMonitorContext;
    });

    let cursorX = Number.NaN;
    let cursorY = Number.NaN;
    try {
      const [x, y] = await invoke<[number, number]>("get_mouse_position");
      cursorX = x;
      cursorY = y;
    } catch {
      // fallback to primary monitor
    }

    if (!Number.isNaN(cursorX) && !Number.isNaN(cursorY)) {
      const logicalMatch = monitorContexts.find((monitor) => inMonitorLogical(cursorX, cursorY, monitor));
      if (logicalMatch) {
        return logicalMatch;
      }

      const physicalMatchIndex = monitors.findIndex((monitor) => {
        return (
          cursorX >= monitor.position.x &&
          cursorX < monitor.position.x + monitor.size.width &&
          cursorY >= monitor.position.y &&
          cursorY < monitor.position.y + monitor.size.height
        );
      });
      if (physicalMatchIndex >= 0) {
        return monitorContexts[physicalMatchIndex];
      }
    }

    return monitorContexts[0];
  }, [t]);

  const loadShortcutsFromStore = useCallback(
    async (store: Store, showMigrationToast: boolean) => {
      const savedShortcuts = await store.get<KeyboardShortcut[]>("keyboardShortcuts");
      const shortcutSchemaVersion = await store.get<number>("shortcutSchemaVersion");
      const unifiedApplied = await store.get<boolean>("shortcutUnifiedApplied");
      const safetyApplied = await store.get<boolean>("shortcutSafetyApplied");

      const hydrated = hydrateShortcuts(savedShortcuts, {
        shortcutSchemaVersion: shortcutSchemaVersion ?? 0,
        unifiedAlreadyApplied: unifiedApplied === true,
        safetyAlreadyApplied: safetyApplied === true,
        enableUnification: true,
        enableSafety: true,
      });

      setShortcuts(hydrated.shortcuts);

      const schemaNeedsUpgrade = (shortcutSchemaVersion ?? 0) < 4;
      if (hydrated.changed || schemaNeedsUpgrade) {
        await store.set("keyboardShortcuts", hydrated.shortcuts);
        if (hydrated.appliedUnification || schemaNeedsUpgrade) {
          await store.set("shortcutSchemaVersion", 4);
          await store.set("shortcutUnifiedApplied", true);
        }
        if (hydrated.appliedSafety) {
          await store.set("shortcutSafetyApplied", true);
        }
        await store.save();
      }

      if (hydrated.appliedUnification && showMigrationToast) {
        toast.success(t("app.toast.shortcutUnifiedApplied"), {
          description: t("app.toast.shortcutUnifiedAppliedDesc"),
          duration: 4500,
        });
      }
    },
    [t],
  );

  const loadSettings = useCallback(async () => {
    try {
      const store = await Store.load("settings.json", {
        defaults: {
          autoApplyBackground: false,
        },
        autoSave: true,
      });

      const savedAutoApply = await store.get<boolean>("autoApplyBackground");
      if (savedAutoApply !== null && savedAutoApply !== undefined) {
        setAutoApplyBackground(savedAutoApply);
      }

      const savedSaveDir = await store.get<string>("saveDir");
      if (savedSaveDir) {
        setSaveDir(savedSaveDir);
      }

      await loadShortcutsFromStore(store, true);
    } catch (loadError) {
      console.error("Failed to load settings:", loadError);
    }
  }, [loadShortcutsFromStore]);

  useEffect(() => {
    const initializeApp = async () => {
      let desktopPath = "";
      try {
        desktopPath = await invoke<string>("get_desktop_directory");
      } catch (desktopError) {
        console.error("Failed to get Desktop directory:", desktopError);
      }

      try {
        const systemTempDir = await invoke<string>("get_temp_directory");
        setTempDir(systemTempDir);
      } catch (tempError) {
        console.error("Failed to get temp directory, using fallback:", tempError);
      }

      try {
        const store = await Store.load("settings.json", {
          defaults: {
            autoApplyBackground: false,
          },
          autoSave: true,
        });

        const savedAutoApply = await store.get<boolean>("autoApplyBackground");
        if (savedAutoApply !== null && savedAutoApply !== undefined) {
          setAutoApplyBackground(savedAutoApply);
        }

        const savedSaveDir = await store.get<string>("saveDir");
        if (savedSaveDir && savedSaveDir.trim() !== "") {
          setSaveDir(savedSaveDir);
        } else {
          setSaveDir(desktopPath);
          if (desktopPath) {
            await store.set("saveDir", desktopPath);
            await store.save();
          }
        }

        await loadShortcutsFromStore(store, true);
      } catch (initializeError) {
        console.error("Failed to load settings:", initializeError);
        if (desktopPath) {
          setSaveDir(desktopPath);
        }
      }
    };

    void initializeApp();

    if (!hasCompletedOnboarding()) {
      setShowOnboarding(true);
    }
  }, [loadShortcutsFromStore]);

  const registerScrollHotkeys = useCallback(async () => {
    await unregisterSet(scrollShortcutsRef);

    const registerTemp = async (accelerator: string, callback: () => void) => {
      await register(accelerator, callback);
      scrollShortcutsRef.current.add(accelerator);
    };

    await registerTemp(SCROLL_HOTKEYS.save, () => {
      void finishScrollCaptureRef.current("save");
    });

    await registerTemp(SCROLL_HOTKEYS.edit, () => {
      void finishScrollCaptureRef.current("edit");
    });

    await registerTemp(SCROLL_HOTKEYS.copy, () => {
      void finishScrollCaptureRef.current("copy_only");
    });

    await registerTemp(SCROLL_HOTKEYS.cancel, () => {
      void cancelScrollCaptureRef.current("user");
    });
  }, [unregisterSet]);

  const cleanupScrollSession = useCallback(
    async (options?: {
      restoreMainWindow?: boolean;
      nextView?: AppView;
      nextImagePath?: string | null;
    }) => {
      const restoreMainWindow = options?.restoreMainWindow ?? true;
      const nextView = options?.nextView ?? "launcher";
      const session = scrollSessionRef.current;

      await unregisterSet(scrollShortcutsRef);
      await invoke("set_main_window_mouse_passthrough", { enabled: false }).catch(() => undefined);

      isScrollSessionActiveRef.current = false;
      scrollLastActivityRef.current = 0;
      scrollSessionRef.current = null;

      if (session) {
        await invoke("cleanup_scroll_temp", { sessionDir: session.sessionDir }).catch(() => undefined);
      }

      setScrollSessionState("idle");
      setScrollFrameCount(0);
      setScrollIsScrolling(false);
      setScrollPreviewPath(null);

      clearOverlayUiState();
      if (options?.nextImagePath) {
        setTempScreenshotPath(options.nextImagePath);
      }
      setAppView(nextView);

      if (restoreMainWindow) {
        await restoreWindow();
      }

      setSettingsVersion((value) => value + 1);
    },
    [clearOverlayUiState, unregisterSet],
  );

  const finishScrollCapture = useCallback(
    async (intent: ScrollFinishIntent = "edit") => {
      const session = scrollSessionRef.current;
      if (!session) return;

      transitionCaptureState({ type: "Space" });
      setScrollSessionState("stitching");
      scrollLastActivityRef.current = Date.now();

      if (session.frames.length < 2) {
        transitionCaptureState({ type: "StitchFail", reason: t("app.error.scrollNotEnough") });
        setScrollSessionState("capturing");
        setError(t("app.error.scrollNotEnough"));
        toast.error(t("app.error.scrollNotEnough"));
        return;
      }

      try {
        const targetDir =
          intent === "save"
            ? settingsRef.current.saveDir
            : intent === "copy_only"
              ? session.sessionDir
              : settingsRef.current.tempDir;

        if (intent === "save") {
          await invoke("validate_save_directory", { path: targetDir });
        }

        const result = await invoke<StitchResult>("stitch_scroll_frames", {
          framePaths: session.frames,
          saveDir: targetDir,
        });

        if (intent === "copy_only") {
          await invoke("copy_image_file_to_clipboard", { path: result.path });
          toast.success(t("app.toast.scrollCopied"), { duration: 2600 });
          await cleanupScrollSession({
            restoreMainWindow: true,
            nextView: "launcher",
          });
          return;
        }

        toast.success(
          intent === "save" ? t("app.toast.scrollSavedOnly") : t("app.toast.scrollCompleted"),
          {
            description:
              result.skippedFrames > 0
                ? t("app.toast.scrollSkippedFrames", {
                    skipped: String(result.skippedFrames),
                    used: String(result.usedFrames),
                  })
                : undefined,
            duration: 3500,
          },
        );

        if (intent === "save") {
          await cleanupScrollSession({ restoreMainWindow: true, nextView: "launcher" });
          return;
        }

        await cleanupScrollSession({
          restoreMainWindow: false,
          nextView: "editing",
          nextImagePath: result.path,
        });
        await restoreWindowOnScreen(
          session.rect.x + session.rect.width / 2,
          session.rect.y + session.rect.height / 2,
        );
      } catch (finishError) {
        const message = finishError instanceof Error ? finishError.message : String(finishError);
        transitionCaptureState({ type: "StitchFail", reason: message });
        setScrollSessionState("failed");
        setError(message);
        toast.error(message);
        await cleanupScrollSession({ restoreMainWindow: true, nextView: "launcher" });
      }
    },
    [cleanupScrollSession, t, transitionCaptureState],
  );

  const cancelScrollCapture = useCallback(
    async (reason: "user" | "timeout" = "user") => {
      transitionCaptureState({ type: "Cancel" });
      if (reason === "timeout") {
        toast.error(t("app.toast.scrollTimeout"), { duration: 2600 });
      } else {
        toast.error(t("app.toast.scrollCancelled"), { duration: 2200 });
      }
      await cleanupScrollSession({ restoreMainWindow: true, nextView: "launcher" });
    },
    [cleanupScrollSession, t, transitionCaptureState],
  );

  useEffect(() => {
    finishScrollCaptureRef.current = finishScrollCapture;
  }, [finishScrollCapture]);

  useEffect(() => {
    cancelScrollCaptureRef.current = cancelScrollCapture;
  }, [cancelScrollCapture]);

  const startScrollSession = useCallback(
    async (rect: CaptureRect) => {
      const sessionDir = `${settingsRef.current.tempDir}/bettershot-scroll-${Date.now()}`;
      const framesDir = `${sessionDir}/frames`;

      scrollSessionRef.current = {
        sessionDir,
        framesDir,
        rect,
        frames: [],
      };

      try {
        transitionCaptureState({ type: "StartScroll" });
        isScrollSessionActiveRef.current = true;
        setScrollSessionState("capturing");
        setScrollFrameCount(0);
        setScrollIsScrolling(false);
        setScrollPreviewPath(null);
        scrollLastActivityRef.current = Date.now();

        await invoke("reset_scroll_monitor");
        await unregisterSet(registeredShortcutsRef);
        await registerScrollHotkeys();
        await invoke("set_main_window_mouse_passthrough", { enabled: true });
      } catch (startError) {
        const message = startError instanceof Error ? startError.message : String(startError);
        setError(message);
        setScrollSessionState("failed");
        await cleanupScrollSession({ restoreMainWindow: true, nextView: "launcher" });
      }
    },
    [cleanupScrollSession, registerScrollHotkeys, transitionCaptureState, unregisterSet],
  );

  useEffect(() => {
    if (scrollSessionState !== "capturing") return;

    const timer = window.setInterval(() => {
      if (!isScrollSessionActiveRef.current) return;
      if (!shouldAutoCancelScrollSession(scrollLastActivityRef.current, Date.now(), SCROLL_SESSION_TIMEOUT_MS)) {
        return;
      }
      scrollLastActivityRef.current = Date.now();
      void cancelScrollCapture("timeout");
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [cancelScrollCapture, scrollSessionState]);

  useEffect(() => {
    if (scrollSessionState !== "capturing") return;
    const session = scrollSessionRef.current;
    if (!session) return;

    let cancelled = false;
    let pollTimeout: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      const currentSession = scrollSessionRef.current;
      if (!currentSession) return;

      try {
        const result = await invoke<ScrollPollResult>("poll_scroll_region", {
          rect: currentSession.rect,
          framesDir: currentSession.framesDir,
        });

        if (cancelled) return;

        if (result.state === "scrolling") {
          setScrollIsScrolling(true);
          transitionCaptureState({ type: "ScrollDetected" });
        } else {
          setScrollIsScrolling(false);
        }

        if (result.state === "captured" && result.framePath) {
          currentSession.frames.push(result.framePath);
          setScrollFrameCount(currentSession.frames.length);
          scrollLastActivityRef.current = Date.now();

          const previewPath = await invoke<string>("stitch_scroll_frames_preview", {
            framePaths: currentSession.frames,
            sessionDir: currentSession.sessionDir,
          }).catch(() => null);

          if (previewPath) {
            setScrollPreviewPath(previewPath);
          }
        }
      } catch (pollError) {
        console.error("Scroll poll error:", pollError);
      }

      if (!cancelled) {
        pollTimeout = setTimeout(poll, 220);
      }
    };

    pollTimeout = setTimeout(poll, 180);

    return () => {
      cancelled = true;
      clearTimeout(pollTimeout);
    };
  }, [scrollSessionState, transitionCaptureState]);

  useEffect(() => {
    if (!isScrollSessionActiveRef.current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void cancelScrollCapture("user");
        return;
      }

      if ((event.key === " " || event.code === "Space") && scrollSessionState === "capturing") {
        event.preventDefault();
        void finishScrollCapture("edit");
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [cancelScrollCapture, finishScrollCapture, scrollSessionState]);

  const openCaptureOverlay = useCallback(async () => {
    if (isScrollSessionActiveRef.current || isCapturingRef.current) return;

    isCapturingRef.current = true;
    setIsCapturing(true);
    setError(null);
    setIsPermissionError(false);

    try {
      const permissionResult = await ensureScreenPermission();
      if (permissionResult !== "granted") {
        setIsPermissionError(true);
        setError(t("app.error.permission"));
        if (permissionResult === "denied") {
          toast.error(t("app.toast.permissionStillDenied"), { duration: 3500 });
        } else {
          toast.error(t("app.toast.permissionCheckFailed"), { duration: 3500 });
        }
        return;
      }

      const monitor = await resolveActiveMonitorByCursor();
      const windows = await invoke<CaptureWindowInfo[]>("list_capture_windows").catch(() => []);
      const windowsOnMonitor = windows.filter((window) => {
        const centerX = window.x + window.width / 2;
        const centerY = window.y + window.height / 2;
        return inMonitorLogical(centerX, centerY, monitor);
      });
      const appWindow = getCurrentWindow();
      await appWindow.hide();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const monitorShots = await invoke<MonitorShot[]>("capture_all_monitors", {
        saveDir: settingsRef.current.tempDir,
      }).catch(() => []);
      const backgroundPath = resolveMonitorBackgroundPath(monitorShots, monitor);

      setAppView("capture");
      await appWindow.setDecorations(false);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setResizable(false);
      await appWindow.setSize(new LogicalSize(monitor.width, monitor.height));
      await appWindow.setPosition(new LogicalPosition(monitor.x, monitor.y));
      await appWindow.show();
      await appWindow.setFocus();

      setActiveMonitor(monitor);
      setOverlayBackgroundPath(backgroundPath);
      setOverlayWindows(windowsOnMonitor);
      setSelectedRect(null);

      setCaptureState({ kind: "Idle" });
      transitionCaptureState({ type: "TriggerCapture", mode: "window" });
      toast(t("app.toast.monitorLocked", { display: monitor.label }), { duration: 2000 });
    } catch (overlayError) {
      const message = overlayError instanceof Error ? overlayError.message : String(overlayError);
      setError(message);
      setAppView("launcher");
      await resetOverlayFlow(true);
    } finally {
      isCapturingRef.current = false;
      setIsCapturing(false);
    }
  }, [ensureScreenPermission, resetOverlayFlow, resolveActiveMonitorByCursor, t, transitionCaptureState]);

  const startCaptureSession = useCallback(async () => {
    const now = Date.now();
    if (now - lastCaptureTimeRef.current < 500) {
      return;
    }
    lastCaptureTimeRef.current = now;
    await openCaptureOverlay();
  }, [openCaptureOverlay]);

  const captureSelectionToTemp = useCallback(async (rect: CaptureRect) => {
    const normalizedRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };

    return invoke<string>("capture_rect_frame", {
      rect: normalizedRect,
      saveDir: settingsRef.current.tempDir,
    });
  }, []);

  const executeSelectionCapture = useCallback(
    async (rect: CaptureRect) => {
      if (isCapturingRef.current) return;
      isCapturingRef.current = true;
      setIsCapturing(true);
      setError(null);
      setIsPermissionError(false);

      const appWindow = getCurrentWindow();
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;

      try {
        transitionCaptureState({ type: "Confirm" });

        await invoke("set_main_window_mouse_passthrough", { enabled: false }).catch(() => undefined);
        await appWindow.hide();
        await new Promise((resolve) => setTimeout(resolve, 120));

        const screenshotPath = await captureSelectionToTemp(rect);
        invoke("play_screenshot_sound").catch(console.error);

        if (settingsRef.current.autoApplyBackground) {
          await invoke("validate_save_directory", { path: settingsRef.current.saveDir });

          const processedImageData = await processScreenshotWithDefaultBackground(screenshotPath);
          const saved = await invoke<SaveImageResponse>("save_edited_image", {
            imageData: processedImageData,
            saveDir: settingsRef.current.saveDir,
            copyToClip: true,
          });

          handleCopyWarning(saved.copy_warning);
          toast.success(t("app.toast.imageSaved"), {
            description: saved.path,
            duration: 3500,
          });

          await resetOverlayFlow(true);
          setAppView("launcher");
          return;
        }

        clearOverlayUiState();
        setTempScreenshotPath(screenshotPath);
        setAppView("editing");
        await restoreWindowOnScreen(centerX, centerY);
      } catch (finishError) {
        const errorMessage = finishError instanceof Error ? finishError.message : String(finishError);
        const errorKind = classifyCaptureError(errorMessage);

        if (errorKind === "cancelled") {
          await resetOverlayFlow(true);
        } else if (errorKind === "permission") {
          setError(t("app.error.permission"));
          setIsPermissionError(true);
          await resetOverlayFlow(true);
        } else {
          setError(errorMessage);
          toast.error(t("app.toast.saveFailed"), {
            description: errorMessage,
            duration: 5000,
          });
          await resetOverlayFlow(true);
        }
      } finally {
        isCapturingRef.current = false;
        setIsCapturing(false);
      }
    },
    [captureSelectionToTemp, clearOverlayUiState, handleCopyWarning, resetOverlayFlow, t, transitionCaptureState],
  );

  const executeRectOcr = useCallback(
    async (rect: CaptureRect) => {
      if (isCapturingRef.current) return;
      isCapturingRef.current = true;
      setIsCapturing(true);
      setError(null);
      setIsPermissionError(false);

      try {
        const recognizedText = await invoke<string>("capture_rect_ocr", {
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          saveDir: settingsRef.current.tempDir,
        });

        toast.success(t("app.toast.ocrSuccess"), {
          description:
            recognizedText.length > 50
              ? `${recognizedText.substring(0, 50)}...`
              : recognizedText,
          duration: 3200,
        });

        await resetOverlayFlow(true);
      } catch (ocrError) {
        const errorMessage = ocrError instanceof Error ? ocrError.message : String(ocrError);
        const errorKind = classifyCaptureError(errorMessage);

        if (errorKind === "cancelled") {
          await resetOverlayFlow(true);
        } else if (errorKind === "permission") {
          setError(t("app.error.permission"));
          setIsPermissionError(true);
          await resetOverlayFlow(true);
        } else if (errorKind === "ocr_empty") {
          setError(t("app.error.ocrEmpty"));
          toast.error(t("app.error.ocrEmpty"), {
            duration: 4000,
          });
          await resetOverlayFlow(true);
        } else {
          setError(errorMessage);
          toast.error(t("app.toast.ocrFailed"), {
            description: errorMessage,
            duration: 5000,
          });
          await resetOverlayFlow(true);
        }
      } finally {
        isCapturingRef.current = false;
        setIsCapturing(false);
      }
    },
    [resetOverlayFlow, t],
  );

  const handleOverlaySelect = useCallback(
    (rect: CaptureRect, source: "window" | "region") => {
      if (!activeMonitor) return;
      const clampedRect = clampRectToMonitor(rect, activeMonitor);
      setSelectedRect(clampedRect);

      setCaptureState((prev) => {
        const selected = reduceCaptureState(
          prev,
          source === "window" ? { type: "PickWindow" } : { type: "SelectRect" },
        );
        return reduceCaptureState(selected, { type: "OpenToolbar" });
      });
    },
    [activeMonitor],
  );

  const handleToolbarRunOcr = useCallback(async () => {
    if (!selectedRect) return;
    await executeRectOcr(selectedRect);
  }, [executeRectOcr, selectedRect]);

  const handleToolbarStartScroll = useCallback(async () => {
    if (!selectedRect) return;
    await startScrollSession(selectedRect);
  }, [selectedRect, startScrollSession]);

  const handleToolbarCancel = useCallback(async () => {
    if (scrollSessionState === "capturing" || scrollSessionState === "stitching") {
      await cancelScrollCapture("user");
      return;
    }

    transitionCaptureState({ type: "Cancel" });
    await resetOverlayFlow(true);
  }, [cancelScrollCapture, resetOverlayFlow, scrollSessionState, transitionCaptureState]);

  const handleToolbarFinish = useCallback(async () => {
    if (scrollSessionState === "capturing") {
      await finishScrollCapture("edit");
      return;
    }

    if (!selectedRect) {
      return;
    }

    await executeSelectionCapture(selectedRect);
  }, [executeSelectionCapture, finishScrollCapture, scrollSessionState, selectedRect]);

  useEffect(() => {
    const overlayVisible = isOverlayCaptureState(captureState) && activeMonitor !== null;
    if (!overlayVisible) return;
    if (scrollSessionState === "capturing" || scrollSessionState === "stitching") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void handleToolbarCancel();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeMonitor, captureState, handleToolbarCancel, scrollSessionState]);

  useEffect(() => {
    const setupHotkeys = async () => {
      try {
        await unregisterSet(registeredShortcutsRef);

        if (isScrollSessionActiveRef.current) {
          return;
        }

        const registrationIssues: ShortcutRegistrationIssue[] = [];
        let registeredShortcutCount = 0;

        const captureShortcut = shortcuts.find((shortcut) => shortcut.id === CAPTURE_SHORTCUT_ID);
        if (captureShortcut?.enabled) {
          const action = resolveCaptureModeByShortcutId(captureShortcut.id);
          if (!action) {
            registrationIssues.push({
              kind: "unknown_shortcut_id",
              message: t("app.error.shortcutUnknownAction", {
                id: captureShortcut.id,
                action: captureShortcut.action,
              }),
              shortcut: captureShortcut.shortcut,
              action: captureShortcut.action,
              reason: captureShortcut.id,
            });
          } else {
            try {
              await register(captureShortcut.shortcut, () => {
                void startCaptureSession();
              });
              registeredShortcutsRef.current.add(captureShortcut.shortcut);
              registeredShortcutCount += 1;
            } catch (registerError) {
              const reason = registerError instanceof Error ? registerError.message : String(registerError);
              registrationIssues.push({
                kind: "register_failed",
                message: t("app.error.shortcutRegisterOne", {
                  shortcut: formatShortcut(captureShortcut.shortcut),
                  action: captureShortcut.action,
                  reason,
                }),
                shortcut: captureShortcut.shortcut,
                action: captureShortcut.action,
                reason,
              });
            }
          }
        }

        const snapshot = deriveHotkeyHealth(shortcuts, registeredShortcutCount, registrationIssues);
        setHotkeyHealth(snapshot);

        if (snapshot.state === "no_enabled_shortcuts") {
          setError(t("app.error.shortcutNoneEnabled"));
          return;
        }

        if (snapshot.state !== "ok") {
          const firstIssue = snapshot.firstIssue?.message ?? t("common.unknown");
          setError(t("app.error.shortcutAllFailed", { issue: firstIssue }));
          toast.error(t("app.toast.shortcutAllFailed"), {
            description: firstIssue,
            duration: 6000,
          });
          return;
        }
      } catch (hotkeyError) {
        const reason = hotkeyError instanceof Error ? hotkeyError.message : String(hotkeyError);
        const issue: ShortcutRegistrationIssue = {
          kind: "register_failed",
          message: reason,
          reason,
        };

        setHotkeyHealth({
          state: "registration_failed",
          enabledCount: shortcuts.filter((shortcut) => shortcut.id === CAPTURE_SHORTCUT_ID && shortcut.enabled)
            .length,
          registeredCount: 0,
          firstIssue: issue,
        });
        setError(`${t("app.error.shortcutRegistration")}: ${reason}`);
        toast.error(t("app.toast.shortcutRegisterFailed"), {
          description: reason,
          duration: 5500,
        });
      }
    };

    void setupHotkeys();

    return () => {
      void unregisterSet(registeredShortcutsRef);
      void unregisterSet(scrollShortcutsRef);
    };
  }, [settingsVersion, shortcuts, startCaptureSession, t, unregisterSet]);

  const startCaptureSessionRef = useRef(startCaptureSession);
  useEffect(() => {
    startCaptureSessionRef.current = startCaptureSession;
  }, [startCaptureSession]);

  useEffect(() => {
    let unlisten1: (() => void) | null = null;
    let unlisten2: (() => void) | null = null;
    let unlisten3: (() => void) | null = null;
    let unlisten4: (() => void) | null = null;
    let unlisten5: (() => void) | null = null;
    let unlisten6: (() => void) | null = null;
    let unlisten7: (() => void) | null = null;
    let mounted = true;

    const setupListeners = async () => {
      unlisten1 = await listen("capture-triggered", () => {
        if (mounted) void startCaptureSessionRef.current();
      });
      unlisten2 = await listen("capture-fullscreen", () => {
        if (mounted) void startCaptureSessionRef.current();
      });
      unlisten3 = await listen("capture-window", () => {
        if (mounted) void startCaptureSessionRef.current();
      });
      unlisten4 = await listen("capture-ocr", () => {
        if (mounted) void startCaptureSessionRef.current();
      });
      unlisten5 = await listen("open-preferences", () => {
        if (mounted) setAppView("preferences");
      });
      unlisten6 = await listen("auto-apply-changed", (event: { payload: boolean }) => {
        if (mounted) setAutoApplyBackground(event.payload);
      });
      unlisten7 = await listen<{ path: string }>("open-editor-for-path", async (event) => {
        if (!mounted) return;

        setTempScreenshotPath(event.payload.path);
        setAppView("editing");

        try {
          await invoke("move_window_to_active_space");
        } catch {
          // best effort
        }
        await restoreWindow();
      });
    };

    void setupListeners();

    return () => {
      mounted = false;
      unlisten1?.();
      unlisten2?.();
      unlisten3?.();
      unlisten4?.();
      unlisten5?.();
      unlisten6?.();
      unlisten7?.();
    };
  }, []);

  const handleSettingsChange = useCallback(async () => {
    await loadSettings();
    setSettingsVersion((v) => v + 1);
  }, [loadSettings]);

  const handleAutoApplyToggle = useCallback(
    async (checked: boolean) => {
      setAutoApplyBackground(checked);
      try {
        const store = await Store.load("settings.json");
        await store.set("autoApplyBackground", checked);
        await store.save();
      } catch (saveError) {
        console.error("Failed to save auto-apply setting:", saveError);
        toast.error(t("preferences.toast.saveFailed"));
      }
    },
    [t],
  );

  const handleBackFromPreferences = useCallback(async () => {
    await loadSettings();
    setSettingsVersion((v) => v + 1);
    setAppView("launcher");
  }, [loadSettings]);

  const handleEditorSave = useCallback(
    async (editedImageData: string) => {
      try {
        await invoke("validate_save_directory", { path: saveDir });
        const saved = await invoke<SaveImageResponse>("save_edited_image", {
          imageData: editedImageData,
          saveDir,
          copyToClip: true,
        });

        handleCopyWarning(saved.copy_warning);
        toast.success(t("app.toast.imageSaved"), {
          description: saved.path,
          duration: 4000,
        });

        editorActions.reset();
        setTempScreenshotPath(null);
        setAppView("launcher");
        transitionCaptureState({ type: "ExportDone" });
      } catch (saveError) {
        const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
        setError(errorMessage);
        toast.error(t("app.toast.saveFailed"), {
          description: errorMessage,
          duration: 5000,
        });
        editorActions.reset();
        setAppView("launcher");
      }
    },
    [handleCopyWarning, saveDir, t, transitionCaptureState],
  );

  const handleEditorCancel = useCallback(() => {
    editorActions.reset();
    setTempScreenshotPath(null);
    setAppView("launcher");
    transitionCaptureState({ type: "Cancel" });
  }, [transitionCaptureState]);

  const captureShortcutDisplay = useMemo(() => {
    const shortcut = shortcuts.find((item) => item.id === CAPTURE_SHORTCUT_ID);
    if (shortcut) {
      return formatShortcut(shortcut.shortcut);
    }
    return formatShortcut(DEFAULT_SHORTCUTS[0].shortcut);
  }, [shortcuts]);

  if (appView === "editing" && tempScreenshotPath) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <EditorShell imagePath={tempScreenshotPath} onSave={handleEditorSave} onCancel={handleEditorCancel} />
      </Suspense>
    );
  }

  if (showOnboarding) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <OnboardingFlow
          onComplete={() => {
            setShowOnboarding(false);
          }}
        />
      </Suspense>
    );
  }

  if (appView === "preferences") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <PreferencesPage
          onBack={handleBackFromPreferences}
          onSettingsChange={handleSettingsChange}
          shortcuts={shortcuts}
          hotkeyHealth={hotkeyHealth}
        />
      </Suspense>
    );
  }

  if (appView === "capture" && activeMonitor) {
    return (
      <main className="h-dvh overflow-hidden bg-transparent text-foreground">
        <CaptureOverlay
          monitor={activeMonitor}
          windows={overlayWindows}
          backgroundPath={overlayBackgroundPath}
          selectedRect={selectedRect}
          scrollCapturing={scrollSessionState === "capturing" || scrollSessionState === "stitching"}
          onSelect={handleOverlaySelect}
        />

        {selectedRect && !(scrollSessionState === "capturing" || scrollSessionState === "stitching") && (
          <SelectionToolbar
            rect={selectedRect}
            scrollCapturing={false}
            onToolChange={() => undefined}
            onRunOcr={() => {
              void handleToolbarRunOcr();
            }}
            onStartScroll={() => {
              void handleToolbarStartScroll();
            }}
            onCancel={() => {
              void handleToolbarCancel();
            }}
            onFinish={() => {
              void handleToolbarFinish();
            }}
          />
        )}

        {selectedRect &&
          (scrollSessionState === "capturing" || scrollSessionState === "stitching") && (
            <>
              <ScrollSessionMiniToolbar
                stitching={scrollSessionState === "stitching"}
                onCancel={() => {
                  void cancelScrollCapture("user");
                }}
                onSave={() => {
                  void finishScrollCapture("save");
                }}
                onEdit={() => {
                  void finishScrollCapture("edit");
                }}
                onCopyOnly={() => {
                  void finishScrollCapture("copy_only");
                }}
              />
              <ScrollPreviewPanel
                monitor={activeMonitor}
                rect={selectedRect}
                previewPath={scrollPreviewPath}
                frameCount={scrollFrameCount}
                isScrolling={scrollIsScrolling}
              />
            </>
        )}
      </main>
    );
  }

  if (appView === "capture" && !activeMonitor) {
    return <main className="h-dvh overflow-hidden bg-transparent" />;
  }

  return (
    <main className="min-h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center p-4 sm:p-8">
        <div className="space-y-5">
          <header className="relative rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="absolute right-4 top-4">
              <SettingsIcon onClick={() => setAppView("preferences")} />
            </div>
            <div className="space-y-2 pr-10">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-semibold text-balance sm:text-4xl">{t("app.title")}</h1>
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  v{__APP_VERSION__}
                </span>
              </div>
              <p className="text-sm text-muted-foreground text-pretty">{t("app.subtitle")}</p>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="button" variant="cta" size="sm" onClick={() => void startCaptureSession()}>
                <Crop className="size-4" aria-hidden="true" />
                {t("app.action.startCapture")}
              </Button>
              <div className="rounded border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                <span className="mr-2">{t("app.action.captureShortcut")}</span>
                <kbd className="rounded border border-border bg-card px-2 py-1 tabular-nums text-foreground">
                  {captureShortcutDisplay}
                </kbd>
              </div>
            </div>
          </header>

          <Card className="border-border bg-card">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t("app.autoApply")}</div>
                  <p className="text-xs text-muted-foreground text-pretty">{t("app.autoApplyDesc")}</p>
                </div>
                <Switch id="auto-apply-toggle" checked={autoApplyBackground} onCheckedChange={handleAutoApplyToggle} />
              </div>

              <div className="rounded-lg border border-border bg-secondary p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{t("app.captureWorkflowTitle")}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground text-pretty">
                  {t("app.captureWorkflowDesc")}
                </p>
              </div>
            </CardContent>
          </Card>

          {(isCapturing || error) && (
            <Card className="border-border bg-card">
              <CardContent className="p-5">
                {isCapturing && (
                  <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <svg className="size-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t("app.waitingSelection")}
                  </div>
                )}

                {error && (
                  <div className="space-y-2 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
                    <div className="font-medium text-red-300">{t("common.error")}</div>
                    <div className="text-sm text-red-400 text-pretty">{error}</div>
                    {isPermissionError && (
                      <div className="space-y-2 pt-1">
                        <p className="text-xs text-red-400/85 text-pretty">{t("app.error.permissionRetry")}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="secondary" onClick={handlePermissionRetry}>
                            {t("app.action.checkPermission")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleOpenScreenRecordingSettings}>
                            {t("app.action.openSettings")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
