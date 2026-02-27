export interface KeyboardShortcut {
  id: string;
  action: string;
  shortcut: string;
  enabled: boolean;
}

export const CAPTURE_SHORTCUT_ID = "capture";

export const BUILT_IN_SHORTCUT_IDS = [CAPTURE_SHORTCUT_ID] as const;

export const LEGACY_DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  { id: "region", action: "Capture Region", shortcut: "CommandOrControl+Shift+2", enabled: true },
  { id: "fullscreen", action: "Capture Screen", shortcut: "CommandOrControl+Shift+F", enabled: false },
  { id: "window", action: "Capture Window", shortcut: "CommandOrControl+Shift+D", enabled: false },
  { id: "ocr", action: "OCR Region", shortcut: "CommandOrControl+Shift+O", enabled: false },
  { id: "scroll", action: "Scroll Capture", shortcut: "CommandOrControl+Shift+5", enabled: false },
];

export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: CAPTURE_SHORTCUT_ID,
    action: "Start Capture",
    shortcut: "CommandOrControl+Alt+Shift+R",
    enabled: true,
  },
];

const LEGACY_BUILT_IN_PRIORITY = ["region", "scroll", "window", "fullscreen", "ocr"] as const;
const LEGACY_BUILT_IN_ID_SET = new Set<string>(LEGACY_BUILT_IN_PRIORITY);

function isLegacyBuiltIn(id: string) {
  return LEGACY_BUILT_IN_ID_SET.has(id);
}

function normalizeCaptureShortcut(shortcut: KeyboardShortcut): KeyboardShortcut {
  return {
    id: CAPTURE_SHORTCUT_ID,
    action: DEFAULT_SHORTCUTS[0].action,
    shortcut: shortcut.shortcut || DEFAULT_SHORTCUTS[0].shortcut,
    enabled: shortcut.enabled,
  };
}

function deriveCaptureFromLegacy(shortcuts: KeyboardShortcut[]): KeyboardShortcut {
  const legacyById = new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut]));

  const preferredEnabled = LEGACY_BUILT_IN_PRIORITY
    .map((id) => legacyById.get(id))
    .find((shortcut) => shortcut?.enabled);

  const fallback =
    preferredEnabled ??
    legacyById.get("region") ??
    legacyById.get("scroll") ??
    legacyById.get("window") ??
    legacyById.get("fullscreen") ??
    legacyById.get("ocr");

  if (!fallback) {
    return { ...DEFAULT_SHORTCUTS[0] };
  }

  return {
    ...DEFAULT_SHORTCUTS[0],
    shortcut: fallback.shortcut || DEFAULT_SHORTCUTS[0].shortcut,
    enabled: fallback.enabled,
  };
}

export function mergeShortcutsWithDefaults(savedShortcuts: KeyboardShortcut[]) {
  const passthroughShortcuts = savedShortcuts.filter(
    (shortcut) => shortcut.id !== CAPTURE_SHORTCUT_ID && !isLegacyBuiltIn(shortcut.id),
  );

  const existingCapture = savedShortcuts.find((shortcut) => shortcut.id === CAPTURE_SHORTCUT_ID);
  const hasLegacyBuiltIn = savedShortcuts.some((shortcut) => isLegacyBuiltIn(shortcut.id));

  const captureShortcut = existingCapture
    ? normalizeCaptureShortcut(existingCapture)
    : hasLegacyBuiltIn
      ? deriveCaptureFromLegacy(savedShortcuts)
      : { ...DEFAULT_SHORTCUTS[0] };

  const changed =
    !existingCapture ||
    hasLegacyBuiltIn ||
    existingCapture.action !== DEFAULT_SHORTCUTS[0].action ||
    existingCapture.shortcut !== captureShortcut.shortcut ||
    existingCapture.enabled !== captureShortcut.enabled;

  return {
    shortcuts: [captureShortcut, ...passthroughShortcuts],
    changed,
  };
}

type HydrateOptions = {
  shortcutSchemaVersion?: number;
  unifiedAlreadyApplied?: boolean;
  safetyAlreadyApplied?: boolean;
  enableUnification?: boolean;
  enableSafety?: boolean;
};

function shouldApplySafetyEnableCapture(shortcuts: KeyboardShortcut[], safetyAlreadyApplied: boolean) {
  if (safetyAlreadyApplied) return false;
  const captureShortcut = shortcuts.find((shortcut) => shortcut.id === CAPTURE_SHORTCUT_ID);
  if (!captureShortcut) return false;
  return captureShortcut.enabled === false;
}

function applySafetyEnableCapture(shortcuts: KeyboardShortcut[]) {
  return shortcuts.map((shortcut) =>
    shortcut.id === CAPTURE_SHORTCUT_ID ? { ...shortcut, enabled: true } : shortcut,
  );
}

export function hydrateShortcuts(
  savedShortcuts: KeyboardShortcut[] | null | undefined,
  options: HydrateOptions = {},
) {
  const shortcutSchemaVersion = options.shortcutSchemaVersion ?? 0;
  const unifiedAlreadyApplied = options.unifiedAlreadyApplied === true;
  const safetyAlreadyApplied = options.safetyAlreadyApplied === true;
  const enableUnification = options.enableUnification !== false;
  const enableSafety = options.enableSafety !== false;

  if (!savedShortcuts || savedShortcuts.length === 0) {
    return {
      shortcuts: DEFAULT_SHORTCUTS,
      changed: false,
      appliedUnification: false,
      appliedSafety: false,
    };
  }

  const shouldUnify = enableUnification && (!unifiedAlreadyApplied || shortcutSchemaVersion < 4);
  const merged = shouldUnify
    ? mergeShortcutsWithDefaults(savedShortcuts)
    : { shortcuts: savedShortcuts, changed: false };

  let shortcuts = merged.shortcuts;
  let appliedSafety = false;

  if (enableSafety && shouldApplySafetyEnableCapture(shortcuts, safetyAlreadyApplied)) {
    shortcuts = applySafetyEnableCapture(shortcuts);
    appliedSafety = true;
  }

  return {
    shortcuts,
    changed: merged.changed || appliedSafety,
    appliedUnification: shouldUnify && merged.changed,
    appliedSafety,
  };
}
