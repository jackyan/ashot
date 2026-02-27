# ashot Product Goals

## Vision

Build a reliable macOS screenshot app with low cognitive load, clear interaction feedback, and recoverable failure paths.

## Product Objectives

1. Make capture workflow predictable: trigger -> select -> act -> export.
2. Keep screenshot interaction in real desktop context (no confusing miniature proxy view).
3. Prioritize stability for permission, hotkeys, and window lifecycle.
4. Support collaboration-friendly delivery with explicit acceptance criteria.

## MVP Functional Scope

1. Region capture with drag selection and dimension hint.
2. Window capture with hover detection and click select.
3. Screen capture through full-area selection behavior.
4. Scroll capture session with explicit controls and deterministic exit.
5. Editor window with basic annotation and export actions.
6. Export channels: save file, copy clipboard, optional share.

## UX Principles

1. Single, low-conflict entry hotkey.
2. Mode selection at the right stage (post-selection toolbar).
3. Visible status for every long-running or error-prone action.
4. Cancellation is always available and reversible.

## Non-goals (Current Phase)

1. Auto-scroll automation across third-party apps.
2. Cross-platform parity (Windows/Linux).
3. Advanced OCR/translation pipeline as blocking item.

## Quality Bar

1. No hidden dead state after failed capture.
2. Permission failures must be actionable, not opaque.
3. Hotkey registration health must be diagnosable in UI.
4. Multi-screen behavior must be deterministic.
