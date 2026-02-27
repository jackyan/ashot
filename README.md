# ashot

`ashot` is a standalone macOS screenshot application project, fully separated from the legacy `better-shot` repository flow.

## Project Scope

- Platform: macOS first
- Stack: Tauri v2 + React + TypeScript + Rust
- Focus: stable capture workflow (region/window/screen/scroll), editor, export

## Repository Layout

```text
.
├── crates/
│   └── capture-core/           # Shared Rust capture domain logic
├── scripts/
│   └── ashot-dev-rebuild-reinstall.sh
├── src/                        # Frontend app code
├── src-tauri/                  # Tauri + Rust backend
└── docs/
    ├── collaboration-template.md
    ├── product-goals.md
    └── technical-implementation.md
```

## Quick Start

```bash
pnpm install
pnpm dev
```

Run isolated Tauri dev:

```bash
pnpm tauri:dev:isolated
```

## Build and Test

```bash
pnpm test
pnpm build
pnpm tauri:build:isolated
```

## Dev Reinstall (Reset Permission + Reinstall App)

```bash
pnpm tauri:dev:reinstall
```

This script will:

1. Stop running `ashot` processes.
2. Remove old `~/Applications/ashot-dev.app`.
3. Clear dev runtime/cache/preferences.
4. Reset TCC permissions for `com.jackyan.ashot.dev`.
5. Rebuild and reinstall isolated app.
6. Launch app and open macOS Screen Recording settings.

## Product and Collaboration Baseline

- Product target doc: `docs/product-goals.md`
- Technical implementation details: `docs/technical-implementation.md`
- External collaboration template (branch policy + test checklist): `docs/collaboration-template.md`
