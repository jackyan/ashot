# ashot Technical Implementation Details

## 1. Runtime Architecture

1. Frontend shell: React + TypeScript (`src/`)
2. Desktop container: Tauri v2 (`src-tauri/`)
3. Shared Rust domain: `crates/capture-core`
4. Local settings/state: Tauri store + frontend state modules

## 2. Core Technical Domains

### 2.1 Capture Flow

1. Trigger capture session from global shortcut.
2. Run permission gate before destructive UI transitions.
3. Enter overlay selection state.
4. Execute capture command in Rust backend.
5. Route result to editor/export pipeline.

### 2.2 Permission Flow

1. `check_screen_permission`
2. `request_screen_permission`
3. `open_screen_recording_settings` fallback
4. Error classification with explicit user guidance

### 2.3 Scroll Session

1. Session lifecycle: start -> sample -> stitch -> finalize/cancel.
2. Ensure temporary file cleanup on all exit paths.
3. Restore main hotkey registration after session close.

### 2.4 Window Lifecycle

1. Standard app activation behavior (Dock + Spotlight recall).
2. Close action hides main window instead of terminating process.
3. Reopen/second-instance events force `show + unminimize + focus`.

## 3. Build and Packaging

## 3.1 Development

```bash
pnpm install
pnpm dev
pnpm tauri:dev:isolated
```

## 3.2 Verification

```bash
pnpm test
pnpm build
pnpm tauri:build:isolated
```

## 3.3 Reinstall Script

`scripts/ashot-dev-rebuild-reinstall.sh` provides deterministic dev reinstall:

1. kill stale processes
2. reset TCC permissions
3. rebuild isolated app
4. reinstall to `~/Applications/ashot-dev.app`

## 4. Release Engineering Baseline

1. Use app bundle (`--bundles app`) as stable default artifact.
2. Keep DMG as optional pipeline if needed.
3. Pin Tauri CLI/API versions to avoid mismatch at build time.

## 5. Testing Strategy

1. Unit tests: permission flow, shortcut hydration, error classifiers.
2. Integration smoke: key capture commands and save/copy routes.
3. Manual matrix:
   - permission states
   - window recall and reopen
   - hotkey registration persistence
   - scroll session recovery

## 6. External Collaboration Rules

1. Branch and submission policy: `docs/collaboration-template.md`
2. Every major behavior change should include:
   - short architecture note
   - acceptance checklist updates
   - rollback notes
