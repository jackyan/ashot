#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ashot-dev.app"
BUNDLE_ID="com.jackyan.ashot.dev"
INSTALL_DIR="$HOME/Applications"
INSTALL_APP_PATH="$INSTALL_DIR/$APP_NAME"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_APP_PATH="$REPO_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS."
  exit 1
fi

require_cmd pnpm
require_cmd tccutil
require_cmd osascript
if [[ ! -x "$LSREGISTER" ]]; then
  echo "lsregister not found at: $LSREGISTER"
  exit 1
fi

cd "$REPO_ROOT"

echo "Stopping running ashot processes..."
pkill -f ashot || true
pkill -x screencapture || true

echo "Cleaning launch agents (best effort)..."
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/ashot.plist" 2>/dev/null || true
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/ashot-dev.plist" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/ashot.plist" "$HOME/Library/LaunchAgents/ashot-dev.plist"

echo "Removing previous ashot dev app install..."
rm -rf "$INSTALL_APP_PATH"

echo "Cleaning previous ashot dev runtime data..."
rm -rf "$HOME/Library/Application Support/$BUNDLE_ID"
rm -rf "$HOME/Library/Caches/$BUNDLE_ID"
rm -f "$HOME/Library/Preferences/$BUNDLE_ID.plist"
rm -rf "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"

echo "Resetting permissions for $BUNDLE_ID..."
tccutil reset ScreenCapture "$BUNDLE_ID" || true
tccutil reset Accessibility "$BUNDLE_ID" || true
killall tccd || true

echo "Building ashot isolated dev app..."
pnpm tauri:build:isolated

if [[ ! -d "$BUILD_APP_PATH" ]]; then
  echo "Build output not found: $BUILD_APP_PATH"
  exit 1
fi

echo "Installing ashot dev app to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
ditto "$BUILD_APP_PATH" "$INSTALL_APP_PATH"

echo "Registering app with LaunchServices..."
"$LSREGISTER" -f "$INSTALL_APP_PATH" >/dev/null 2>&1 || true

echo "Launching ashot dev app..."
open -n "$INSTALL_APP_PATH"

echo "Opening Screen Recording settings..."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

echo "Done. ashot dev app was rebuilt, reinstalled, and permission state reset."
