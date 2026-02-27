# ashot External Collaboration Template

Use this template when onboarding external contributors, vendors, or agents.

## 1. Branch Policy

### Naming Convention

- Feature: `feat/<scope>-<short-desc>`
- Fix: `fix/<scope>-<short-desc>`
- Refactor: `refactor/<scope>-<short-desc>`
- Docs: `docs/<scope>-<short-desc>`
- Release prep: `release/<version>`

Examples:

- `feat/overlay-single-shortcut`
- `fix/permission-dialog-flow`
- `refactor/scroll-session-state`

### Rules

1. Never develop directly on `main`.
2. One branch should contain one coherent problem domain.
3. Rebase or merge `main` before opening PR.
4. Keep PR size reviewable (recommended: <= 500 effective LOC).

## 2. Pull Request Template

Copy this section into your PR description:

```md
## Background

## Goal

## Changes
1.
2.
3.

## Risk

## Rollback Plan

## Verification Evidence
- [ ] Unit tests
- [ ] Manual scenarios
- [ ] Build pass
```

## 3. Test Submission Checklist

### Mandatory CI/Local Commands

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm tauri:build:isolated`

### Core Manual Scenarios

- [ ] First-run permission path (allow/deny/retry)
- [ ] Capture trigger and session exit (`Esc`, finish, cancel)
- [ ] Window recall (Dock, Spotlight, reopen)
- [ ] Shortcut registration persistence after restart
- [ ] Save/copy/export path and error feedback
- [ ] Scroll session start/finish/cancel/recovery

### Multi-screen (if touched)

- [ ] Trigger monitor lock behavior
- [ ] No coordinate distortion on Retina/non-Retina mix

### Evidence Requirement

- [ ] Attach screenshots or short recording for changed interaction flow
- [ ] Include logs/errors for failure-path changes
- [ ] Note known limitations explicitly

## 4. Definition of Done

1. Acceptance scenarios passed.
2. No new lint/type/test regressions.
3. User-facing behavior change documented.
4. Rollback path verified.
