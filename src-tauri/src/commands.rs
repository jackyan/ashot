//! Tauri commands module

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use xcap::Window;

#[cfg(target_os = "macos")]
use objc2::msg_send;
use objc2_app_kit::NSWindow;

use crate::clipboard::{copy_image_to_clipboard, copy_text_to_clipboard};
use crate::image::{
    copy_screenshot_to_dir, crop_image, render_image_with_effects, save_base64_image, CropRegion,
    RenderSettings,
};
use crate::ocr::recognize_text_from_image;
use crate::screencapturekit::{
    capture_rect_frame_screen_capture_kit, preferred_scroll_capture_backend, CaptureRectInput,
    ScrollCaptureBackend,
};
use crate::screenshot::{
    capture_all_monitors as capture_monitors, capture_primary_monitor, MonitorShot,
};
use crate::utils::{generate_filename, get_desktop_path};

static SCREENCAPTURE_LOCK: Mutex<()> = Mutex::new(());

const MAX_SCROLL_FRAMES: usize = 80;
const MIN_SCROLL_OVERLAP: u32 = 24;
const MIN_SCROLL_NEW_CONTENT: u32 = 40;
const MAX_SCROLL_MATCH_ERROR: f64 = 42.0;

/// Tracks state for auto-capture scroll monitoring.
/// The frontend polls at ~200ms intervals; this state determines
/// whether content is scrolling or has stabilized.
struct ScrollMonitorState {
    /// Previous frame for comparison
    prev_frame: Option<image::RgbaImage>,
    /// Was content scrolling last poll?
    was_scrolling: bool,
    /// Number of consecutive stable polls
    stable_count: u32,
    /// Total frames captured in this session
    frame_count: usize,
}

static SCROLL_MONITOR: Mutex<Option<ScrollMonitorState>> = Mutex::new(None);

#[derive(Debug, Serialize)]
pub struct SaveImageResponse {
    pub path: String,
    pub copy_warning: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureWindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub z: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

fn is_permission_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("permission")
        || lower.contains("denied")
        || lower.contains("not authorized")
        || lower.contains("could not create image from display")
}

fn permission_required_error() -> String {
    "permission:Screen Recording permission required. Please grant permission in System Settings > Privacy & Security > Screen Recording.".to_string()
}

fn ensure_save_dir(save_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(save_dir);
    fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create save directory '{}': {}", save_dir, e))?;
    Ok(path)
}

fn validate_rect(rect: &CaptureRect) -> Result<(), String> {
    if rect.width < 10 || rect.height < 10 {
        return Err("Capture area is too small".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn move_window_to_active_space(app_handle: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or("Main window not found")?;

        window
            .with_webview(move |webview| {
                let ns_window = webview.ns_window();
                if ns_window.is_null() {
                    return;
                }
                let ns_window = unsafe { &*ns_window.cast::<NSWindow>() };
                let current: usize = unsafe { msg_send![ns_window, collectionBehavior] };
                let move_to_active_space: usize = 1 << 1;
                let new_behavior = current | move_to_active_space;
                let _: () = unsafe { msg_send![ns_window, setCollectionBehavior: new_behavior] };
                let _: () = unsafe { msg_send![ns_window, orderFrontRegardless] };
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_main_window_mouse_passthrough(
    app_handle: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or("Main window not found")?;

        window
            .with_webview(move |webview| {
                let ns_window = webview.ns_window();
                if ns_window.is_null() {
                    return;
                }
                let ns_window = unsafe { &*ns_window.cast::<NSWindow>() };
                let _: () = unsafe { msg_send![ns_window, setIgnoresMouseEvents: enabled] };
            })
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_image_file_to_clipboard(path: String) -> Result<(), String> {
    copy_image_to_clipboard(&path).map_err(|e| e.to_string())
}

/// Quick capture of primary monitor
#[tauri::command]
pub async fn capture_once(
    app_handle: AppHandle,
    save_dir: String,
    copy_to_clip: bool,
) -> Result<String, String> {
    let screenshot_path = capture_primary_monitor(app_handle).await?;
    let screenshot_path_str = screenshot_path.to_string_lossy().to_string();

    let saved_path = copy_screenshot_to_dir(&screenshot_path_str, &save_dir)?;

    if copy_to_clip {
        copy_image_to_clipboard(&saved_path)?;
    }

    Ok(saved_path)
}

/// Capture all monitors with geometry info
#[tauri::command]
pub async fn capture_all_monitors(
    _app_handle: AppHandle,
    save_dir: String,
) -> Result<Vec<MonitorShot>, String> {
    capture_monitors(&save_dir)
}

/// Crop a region from a screenshot
#[tauri::command]
pub async fn capture_region(
    screenshot_path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    save_dir: String,
) -> Result<String, String> {
    let region = CropRegion {
        x,
        y,
        width,
        height,
    };
    crop_image(&screenshot_path, region, &save_dir)
}

/// Render image with effects using Rust (optimized for blur)
#[tauri::command]
pub async fn render_image_with_effects_rust(
    image_path: String,
    settings: RenderSettings,
) -> Result<String, String> {
    render_image_with_effects(&image_path, settings)
}

/// Save an edited image from base64 data
#[tauri::command]
pub async fn save_edited_image(
    image_data: String,
    save_dir: String,
    copy_to_clip: bool,
) -> Result<SaveImageResponse, String> {
    let saved_path = save_base64_image(&image_data, &save_dir, "bettershot")?;

    let copy_warning = if copy_to_clip {
        copy_image_to_clipboard(&saved_path).err()
    } else {
        None
    };

    Ok(SaveImageResponse {
        path: saved_path,
        copy_warning,
    })
}

/// Get the user's Desktop directory path (cross-platform)
#[tauri::command]
pub async fn get_desktop_directory() -> Result<String, String> {
    get_desktop_path()
}

/// Get the system temp directory path (cross-platform)
/// Returns the canonical/resolved path to avoid symlink issues
#[tauri::command]
pub async fn get_temp_directory() -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    // Canonicalize to resolve symlinks (e.g., /tmp -> /private/tmp on macOS)
    let canonical = temp_dir.canonicalize().unwrap_or(temp_dir);
    canonical
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert temp directory path to string".to_string())
}

/// Validate and prepare save directory (create + writable test)
#[tauri::command]
pub async fn validate_save_directory(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Save directory is required".to_string());
    }

    let dir = ensure_save_dir(&path)?;
    let test_file = dir.join(format!(".bettershot_write_test_{}", std::process::id()));

    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&test_file)
        .map_err(|e| format!("Directory is not writable '{}': {}", path, e))?;

    let _ = fs::remove_file(test_file);
    Ok(())
}

/// Check if screencapture is already running
fn is_screencapture_running() -> bool {
    let output = Command::new("pgrep")
        .arg("-x")
        .arg("screencapture")
        .output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Check screen recording permission using CoreGraphics API.
/// Unlike the old screencapture CLI approach, this checks the TCC database
/// directly and respects permission changes without requiring app restart.
fn check_and_activate_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};

        if !CGPreflightScreenCaptureAccess() {
            // Trigger the system permission dialog (non-blocking)
            let _ = CGRequestScreenCaptureAccess();

            // Re-check after the request
            if !CGPreflightScreenCaptureAccess() {
                return Err("permission:Screen Recording permission not granted".to_string());
            }
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    Ok(())
}

/// Query screen recording permission status without triggering capture.
/// Frontend can call this to poll permission state after user grants access.
#[tauri::command]
pub async fn check_screen_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::CGPreflightScreenCaptureAccess;
        Ok(CGPreflightScreenCaptureAccess())
    }

    #[cfg(not(target_os = "macos"))]
    Ok(true)
}

#[tauri::command]
pub async fn list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        let windows = Window::all().map_err(|e| format!("Failed to list windows: {}", e))?;
        let mut list = Vec::new();

        for window in windows {
            let is_minimized = window.is_minimized().unwrap_or(false);
            if is_minimized {
                continue;
            }

            let width = match window.width() {
                Ok(value) if value >= 80 => value,
                _ => continue,
            };
            let height = match window.height() {
                Ok(value) if value >= 80 => value,
                _ => continue,
            };

            let app_name = window.app_name().unwrap_or_default();
            let app_name_lower = app_name.to_lowercase();
            if app_name_lower.contains("better shot") || app_name_lower.contains("bettershot") {
                continue;
            }

            let monitor_scale = window
                .current_monitor()
                .ok()
                .and_then(|monitor| monitor.scale_factor().ok())
                .filter(|value| *value > 0.0)
                .unwrap_or(1.0);

            let x = match window.x() {
                Ok(value) => (value as f32 / monitor_scale).round() as i32,
                Err(_) => continue,
            };
            let y = match window.y() {
                Ok(value) => (value as f32 / monitor_scale).round() as i32,
                Err(_) => continue,
            };
            let logical_width = ((width as f32 / monitor_scale).round().max(1.0)) as u32;
            let logical_height = ((height as f32 / monitor_scale).round().max(1.0)) as u32;

            list.push(CaptureWindowInfo {
                id: window.id().unwrap_or_default(),
                app_name,
                title: window.title().unwrap_or_default(),
                x,
                y,
                width: logical_width,
                height: logical_height,
                z: window.z().unwrap_or_default(),
            });
        }

        list.sort_by(|a, b| b.z.cmp(&a.z));
        Ok(list)
    }

    #[cfg(not(target_os = "macos"))]
    Ok(Vec::new())
}

/// Request Screen Recording permission prompt from macOS.
/// Returns whether permission is granted after the request.
#[tauri::command]
pub async fn request_screen_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::CGRequestScreenCaptureAccess;
        Ok(CGRequestScreenCaptureAccess())
    }

    #[cfg(not(target_os = "macos"))]
    Ok(true)
}

fn open_with_open_command(target: &str) -> Result<(), String> {
    let output = Command::new("open")
        .arg(target)
        .output()
        .map_err(|e| format!("Failed to run open for '{}': {}", target, e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err(format!("open returned non-zero for '{}'", target));
    }
    Err(format!("open failed for '{}': {}", target, stderr))
}

/// Open macOS Screen Recording settings page with fallback targets.
#[tauri::command]
pub async fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let targets = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
            "/System/Applications/System Settings.app",
        ];

        let mut errors = Vec::new();
        for target in targets {
            match open_with_open_command(target) {
                Ok(()) => return Ok(()),
                Err(err) => errors.push(err),
            }
        }

        return Err(format!(
            "command_failed:Failed to open Screen Recording settings: {}",
            errors.join(" | ")
        ));
    }

    #[cfg(not(target_os = "macos"))]
    Err("command_failed:Opening Screen Recording settings is only supported on macOS".to_string())
}

fn map_permission_check_error(error: String) -> String {
    if error.starts_with("permission:") {
        return permission_required_error();
    }
    if error.starts_with("command_failed:") || error.starts_with("cancelled:") {
        return error;
    }
    if is_permission_error(&error) {
        return permission_required_error();
    }
    format!("command_failed:{}", error)
}

/// Capture screenshot using macOS native screencapture with interactive selection
/// This properly handles Screen Recording permissions through the system
#[tauri::command]
pub async fn native_capture_interactive(save_dir: String) -> Result<String, String> {
    let _lock = SCREENCAPTURE_LOCK
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if is_screencapture_running() {
        return Err("Another screenshot capture is already in progress".to_string());
    }

    check_and_activate_permission().map_err(map_permission_check_error)?;

    let filename = generate_filename("screenshot", "png")?;
    let save_path = PathBuf::from(&save_dir);
    std::fs::create_dir_all(&save_path)
        .map_err(|e| format!("Failed to create save directory '{}': {}", save_dir, e))?;
    let screenshot_path = save_path.join(&filename);
    let path_str = screenshot_path.to_string_lossy().to_string();

    let child = Command::new("screencapture")
        .arg("-i")
        .arg("-x")
        .arg(&path_str)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for screencapture: {}", e))?;

    if !output.status.success() {
        if screenshot_path.exists() {
            let _ = std::fs::remove_file(&screenshot_path);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_permission_error(&stderr) {
            return Err(permission_required_error());
        }
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.is_empty() {
            return Err("cancelled:Screenshot was cancelled or failed".to_string());
        }
        return Err(format!(
            "command_failed:Screenshot command failed: {}",
            stderr_trimmed
        ));
    }

    if screenshot_path.exists() {
        Ok(path_str)
    } else {
        Err("cancelled:Screenshot was cancelled or failed".to_string())
    }
}

/// Capture full screen using macOS native screencapture
#[tauri::command]
pub async fn native_capture_fullscreen(save_dir: String) -> Result<String, String> {
    let _lock = SCREENCAPTURE_LOCK
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if is_screencapture_running() {
        return Err("Another screenshot capture is already in progress".to_string());
    }

    check_and_activate_permission().map_err(map_permission_check_error)?;

    let filename = generate_filename("screenshot", "png")?;
    let save_path = PathBuf::from(&save_dir);
    std::fs::create_dir_all(&save_path)
        .map_err(|e| format!("Failed to create save directory '{}': {}", save_dir, e))?;
    let screenshot_path = save_path.join(&filename);
    let path_str = screenshot_path.to_string_lossy().to_string();

    let status = Command::new("screencapture")
        .arg("-x")
        .arg(&path_str)
        .status()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    if !status.success() {
        return Err("command_failed:Screenshot failed".to_string());
    }

    if screenshot_path.exists() {
        Ok(path_str)
    } else {
        Err("command_failed:Screenshot failed".to_string())
    }
}

/// Play the macOS screenshot sound using CoreAudio
/// This uses AudioServicesPlaySystemSound which is non-blocking and works
/// even when other audio/video is playing. Falls back to osascript if CoreAudio fails.
#[tauri::command]
pub async fn play_screenshot_sound() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_audio_toolbox::{
            AudioServicesCreateSystemSoundID, AudioServicesDisposeSystemSoundID,
            AudioServicesPlaySystemSound, SystemSoundID,
        };
        use objc2_core_foundation::{CFString, CFURLPathStyle, CFURL};
        use std::ptr::NonNull;

        let sound_path = "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif";

        std::thread::spawn(move || {
            let cfstr = CFString::from_str(sound_path);
            let url = match CFURL::with_file_system_path(
                None,
                Some(&cfstr),
                CFURLPathStyle::CFURLPOSIXPathStyle,
                false,
            ) {
                Some(url) => url,
                None => {
                    fallback_sound_playback();
                    return;
                }
            };

            let mut sound_id: SystemSoundID = 0;
            let status = unsafe {
                AudioServicesCreateSystemSoundID(&url, NonNull::new(&mut sound_id).unwrap())
            };

            if status != 0 {
                fallback_sound_playback();
                return;
            }

            unsafe {
                AudioServicesPlaySystemSound(sound_id);
            }

            std::thread::sleep(std::time::Duration::from_millis(1000));

            unsafe {
                AudioServicesDisposeSystemSoundID(sound_id);
            }
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("play_screenshot_sound is only supported on macOS");
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn fallback_sound_playback() {
    let sound_path = "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif";

    let _ = Command::new("osascript")
        .arg("-e")
        .arg(format!("do shell script \"afplay '{}' &\"", sound_path))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// Get the current mouse cursor position (for determining which screen to open editor on)
#[tauri::command]
pub async fn get_mouse_position() -> Result<(f64, f64), String> {
    // Use AppleScript to get mouse position - it's the most reliable cross-version approach
    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to return (get position of mouse)")
        .output()
        .map_err(|e| format!("Failed to get mouse position: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get mouse position".to_string());
    }

    let position_str = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = position_str.trim().split(", ").collect();

    if parts.len() != 2 {
        return Err("Invalid mouse position format".to_string());
    }

    let x: f64 = parts[0]
        .parse()
        .map_err(|_| "Failed to parse X coordinate")?;
    let y: f64 = parts[1]
        .parse()
        .map_err(|_| "Failed to parse Y coordinate")?;

    Ok((x, y))
}

/// Capture specific window using macOS native screencapture
#[tauri::command]
pub async fn native_capture_window(save_dir: String) -> Result<String, String> {
    let _lock = SCREENCAPTURE_LOCK
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if is_screencapture_running() {
        return Err("Another screenshot capture is already in progress".to_string());
    }

    check_and_activate_permission().map_err(map_permission_check_error)?;

    let filename = generate_filename("screenshot", "png")?;
    let save_path = PathBuf::from(&save_dir);
    std::fs::create_dir_all(&save_path)
        .map_err(|e| format!("Failed to create save directory '{}': {}", save_dir, e))?;
    let screenshot_path = save_path.join(&filename);
    let path_str = screenshot_path.to_string_lossy().to_string();

    let child = Command::new("screencapture")
        .arg("-w")
        .arg("-x")
        .arg(&path_str)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for screencapture: {}", e))?;

    if !output.status.success() {
        if screenshot_path.exists() {
            let _ = std::fs::remove_file(&screenshot_path);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_permission_error(&stderr) {
            return Err(permission_required_error());
        }
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.is_empty() {
            return Err("cancelled:Screenshot was cancelled or failed".to_string());
        }
        return Err(format!(
            "command_failed:Screenshot command failed: {}",
            stderr_trimmed
        ));
    }

    if screenshot_path.exists() {
        Ok(path_str)
    } else {
        Err("cancelled:Screenshot was cancelled or failed".to_string())
    }
}

fn sample_frame_difference(prev: &image::RgbaImage, current: &image::RgbaImage) -> f64 {
    let width = prev.width();
    let height = prev.height();
    if width == 0 || height == 0 {
        return 255.0;
    }

    let col_step = (width / 80).max(1);
    let row_step = (height / 80).max(1);
    let mut total = 0.0;
    let mut count = 0u64;

    let mut y = 0;
    while y < height {
        let mut x = 0;
        while x < width {
            let p = prev.get_pixel(x, y);
            let c = current.get_pixel(x, y);
            total += ((p[0] as f64 - c[0] as f64).abs()
                + (p[1] as f64 - c[1] as f64).abs()
                + (p[2] as f64 - c[2] as f64).abs())
                / 3.0;
            count += 1;
            x = x.saturating_add(col_step);
        }
        y = y.saturating_add(row_step);
    }

    if count == 0 {
        return 255.0;
    }
    total / count as f64
}

fn overlap_error(prev: &image::RgbaImage, current: &image::RgbaImage, overlap: u32) -> f64 {
    let width = prev.width();
    let height = prev.height();
    if overlap == 0 || overlap > height {
        return f64::MAX;
    }

    let x_start = width * 15 / 100;
    let x_end = width * 85 / 100;
    let col_step = ((x_end.saturating_sub(x_start)) / 70).max(1);
    let row_step = (overlap / 80).max(1);

    let mut total = 0.0;
    let mut samples = 0u64;
    let mut r = 0;
    while r < overlap {
        let prev_y = height - overlap + r;
        let curr_y = r;
        let mut x = x_start;
        while x < x_end {
            let p = prev.get_pixel(x, prev_y);
            let c = current.get_pixel(x, curr_y);
            total += ((p[0] as f64 - c[0] as f64).abs()
                + (p[1] as f64 - c[1] as f64).abs()
                + (p[2] as f64 - c[2] as f64).abs())
                / 3.0;
            samples += 1;
            x = x.saturating_add(col_step);
        }
        r = r.saturating_add(row_step);
    }

    if samples == 0 {
        return f64::MAX;
    }
    total / samples as f64
}

fn find_best_overlap(
    prev: &image::RgbaImage,
    current: &image::RgbaImage,
) -> Result<(u32, f64), String> {
    let height = prev.height();
    let min_overlap = MIN_SCROLL_OVERLAP.min(height.saturating_sub(1));
    let max_overlap = height
        .saturating_sub(MIN_SCROLL_NEW_CONTENT)
        .max(min_overlap);

    let mut best_overlap = 0;
    let mut best_error = f64::MAX;
    let mut overlap = min_overlap;

    while overlap <= max_overlap {
        let err = overlap_error(prev, current, overlap);
        if err < best_error {
            best_error = err;
            best_overlap = overlap;
        }
        overlap = overlap.saturating_add(2);
    }

    if best_overlap == 0 {
        return Err("Failed to detect overlap between captured frames".to_string());
    }

    if best_error > MAX_SCROLL_MATCH_ERROR {
        return Err(
            "Scroll frame matching failed. Try slower scrolling and keep region stable."
                .to_string(),
        );
    }

    Ok((best_overlap, best_error))
}

fn capture_rect_frame_cli(rect: &CaptureRect, save_dir: &str) -> Result<String, String> {
    let _lock = SCREENCAPTURE_LOCK
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if is_screencapture_running() {
        return Err("Another screenshot capture is already in progress".to_string());
    }

    check_and_activate_permission().map_err(map_permission_check_error)?;

    let filename = generate_filename("scroll_frame", "png")?;
    let save_path = ensure_save_dir(save_dir)?;
    let screenshot_path = save_path.join(filename);
    let path_str = screenshot_path.to_string_lossy().to_string();

    let rect_arg = format!("{},{},{},{}", rect.x, rect.y, rect.width, rect.height);
    let output = Command::new("screencapture")
        .arg("-x")
        .arg("-R")
        .arg(rect_arg)
        .arg(&path_str)
        .output()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if is_permission_error(&stderr) {
            return Err(permission_required_error());
        }
        if stderr.is_empty() {
            return Err("command_failed:Failed to capture scroll frame".to_string());
        }
        return Err(format!(
            "command_failed:Failed to capture scroll frame: {}",
            stderr
        ));
    }

    if !screenshot_path.exists() {
        return Err("command_failed:Failed to capture scroll frame".to_string());
    }

    Ok(path_str)
}

#[tauri::command]
pub async fn capture_rect_frame(
    app_handle: AppHandle,
    rect: CaptureRect,
    save_dir: String,
) -> Result<String, String> {
    validate_rect(&rect)?;

    if is_screencapture_running() {
        return Err("Another screenshot capture is already in progress".to_string());
    }

    match preferred_scroll_capture_backend() {
        ScrollCaptureBackend::ScreenCaptureKit => {
            check_and_activate_permission().map_err(map_permission_check_error)?;
            let capture_result = capture_rect_frame_screen_capture_kit(
                app_handle,
                CaptureRectInput {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                },
                &save_dir,
            )
            .await;

            match capture_result {
                Ok(path) => {
                    eprintln!("Scroll capture backend: ScreenCaptureKit");
                    Ok(path)
                }
                Err(err) => {
                    if err.starts_with("permission:") || err.starts_with("cancelled:") {
                        Err(err)
                    } else {
                        eprintln!(
                            "ScreenCaptureKit backend failed ({}), falling back to screencapture CLI",
                            err
                        );
                        capture_rect_frame_cli(&rect, &save_dir)
                    }
                }
            }
        }
        ScrollCaptureBackend::ScreencaptureCli => {
            eprintln!("Scroll capture backend: screencapture CLI");
            capture_rect_frame_cli(&rect, &save_dir)
        }
    }
}

#[tauri::command]
pub async fn capture_rect_ocr(
    app_handle: AppHandle,
    rect: CaptureRect,
    save_dir: String,
) -> Result<String, String> {
    validate_rect(&rect)?;

    let frame_path = capture_rect_frame(app_handle, rect, save_dir).await?;
    let recognized_text = match recognize_text_from_image(&frame_path) {
        Ok(text) => text,
        Err(error) => {
            let _ = fs::remove_file(&frame_path);
            return Err(format!("command_failed:OCR failed: {}", error));
        }
    };
    let _ = fs::remove_file(&frame_path);

    let trimmed = recognized_text.trim();
    if trimmed.is_empty() {
        return Err("ocr_empty:No text recognized".to_string());
    }

    copy_text_to_clipboard(trimmed)
        .map_err(|error| format!("command_failed:Failed to copy OCR text: {}", error))?;

    Ok(trimmed.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollPollResult {
    /// "unchanged" | "scrolling" | "captured"
    pub state: String,
    pub frame_path: Option<String>,
    pub frame_count: usize,
}

/// Reset scroll monitor state. Call at session start.
#[tauri::command]
pub async fn reset_scroll_monitor() -> Result<(), String> {
    let mut monitor = SCROLL_MONITOR
        .lock()
        .map_err(|e| format!("Failed to acquire monitor lock: {}", e))?;
    *monitor = Some(ScrollMonitorState {
        prev_frame: None,
        was_scrolling: false,
        stable_count: 0,
        frame_count: 0,
    });
    Ok(())
}

/// Poll the scroll region for content changes. Called by frontend every ~200ms.
/// Returns:
///   "unchanged" - content has not changed since last poll
///   "scrolling" - content is actively changing (user is scrolling)
///   "captured"  - content was scrolling but has now stabilized → frame saved
#[tauri::command]
pub async fn poll_scroll_region(
    app_handle: AppHandle,
    rect: CaptureRect,
    frames_dir: String,
) -> Result<ScrollPollResult, String> {
    validate_rect(&rect)?;

    // Capture the current region
    let current_frame = match preferred_scroll_capture_backend() {
        ScrollCaptureBackend::ScreenCaptureKit => {
            let path = capture_rect_frame_screen_capture_kit(
                app_handle,
                CaptureRectInput {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                },
                &frames_dir,
            )
            .await?;
            let frame = image::open(&path)
                .map_err(|e| format!("Failed to read captured frame: {}", e))?
                .to_rgba8();
            let _ = std::fs::remove_file(&path); // Remove temp file, we only need the image data
            frame
        }
        ScrollCaptureBackend::ScreencaptureCli => {
            let path = capture_rect_frame_cli(&rect, &frames_dir)?;
            let frame = image::open(&path)
                .map_err(|e| format!("Failed to read captured frame: {}", e))?
                .to_rgba8();
            let _ = std::fs::remove_file(&path);
            frame
        }
    };

    let mut monitor = SCROLL_MONITOR
        .lock()
        .map_err(|e| format!("Failed to acquire monitor lock: {}", e))?;

    let state = monitor.get_or_insert_with(|| ScrollMonitorState {
        prev_frame: None,
        was_scrolling: false,
        stable_count: 0,
        frame_count: 0,
    });

    let Some(ref prev_frame) = state.prev_frame else {
        // First poll - store frame as baseline, capture it as frame 0
        let filename = generate_filename("scroll_frame", "png")?;
        let save_path = PathBuf::from(&frames_dir).join(&filename);
        fs::create_dir_all(&frames_dir)
            .map_err(|e| format!("Failed to create frames dir: {}", e))?;
        current_frame
            .save(&save_path)
            .map_err(|e| format!("Failed to save initial frame: {}", e))?;

        let path_str = save_path
            .to_str()
            .ok_or("Failed to encode frame path")?
            .to_string();

        state.prev_frame = Some(current_frame);
        state.frame_count = 1;

        return Ok(ScrollPollResult {
            state: "captured".to_string(),
            frame_path: Some(path_str),
            frame_count: 1,
        });
    };

    let diff = sample_frame_difference(prev_frame, &current_frame);

    if diff >= 1.8 {
        // Content is changing → user is scrolling
        state.was_scrolling = true;
        state.stable_count = 0;
        // Update prev_frame to latest so we detect when scrolling stops
        state.prev_frame = Some(current_frame);

        Ok(ScrollPollResult {
            state: "scrolling".to_string(),
            frame_path: None,
            frame_count: state.frame_count,
        })
    } else if state.was_scrolling {
        // Content was scrolling and is now stable → auto-capture
        state.was_scrolling = false;
        state.stable_count = 0;

        // Save this frame
        let filename = generate_filename("scroll_frame", "png")?;
        let save_path = PathBuf::from(&frames_dir).join(&filename);
        fs::create_dir_all(&frames_dir)
            .map_err(|e| format!("Failed to create frames dir: {}", e))?;
        current_frame
            .save(&save_path)
            .map_err(|e| format!("Failed to save scroll frame: {}", e))?;

        let path_str = save_path
            .to_str()
            .ok_or("Failed to encode frame path")?
            .to_string();

        state.prev_frame = Some(current_frame);
        state.frame_count += 1;

        Ok(ScrollPollResult {
            state: "captured".to_string(),
            frame_path: Some(path_str),
            frame_count: state.frame_count,
        })
    } else {
        // Content unchanged and wasn't scrolling before
        Ok(ScrollPollResult {
            state: "unchanged".to_string(),
            frame_path: None,
            frame_count: state.frame_count,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StitchResult {
    pub path: String,
    pub total_frames: usize,
    pub used_frames: usize,
    pub skipped_frames: usize,
    pub final_height: u32,
}

#[tauri::command]
pub async fn stitch_scroll_frames(
    frame_paths: Vec<String>,
    save_dir: String,
) -> Result<StitchResult, String> {
    if frame_paths.len() < 2 {
        return Err("At least two frames are required to stitch scroll capture".to_string());
    }
    if frame_paths.len() > MAX_SCROLL_FRAMES {
        return Err(format!("Too many frames. Maximum is {}", MAX_SCROLL_FRAMES));
    }

    let total_frames = frame_paths.len();
    let mut loaded_frames = Vec::with_capacity(total_frames);
    for path in &frame_paths {
        let frame = image::open(path)
            .map_err(|e| format!("Failed to open frame '{}': {}", path, e))?
            .to_rgba8();
        loaded_frames.push(frame);
    }

    let width = loaded_frames[0].width();
    let height = loaded_frames[0].height();
    if width < 20 || height < 20 {
        return Err("Captured frame is too small".to_string());
    }

    for frame in loaded_frames.iter().skip(1) {
        if frame.width() != width || frame.height() != height {
            return Err("Scroll frames have different dimensions".to_string());
        }
    }

    let mut pieces: Vec<image::RgbaImage> = vec![loaded_frames[0].clone()];
    let mut prev_frame = loaded_frames[0].clone();
    let mut skipped_frames = 0usize;

    for (idx, frame) in loaded_frames.iter().skip(1).enumerate() {
        let frame_diff = sample_frame_difference(&prev_frame, frame);
        if frame_diff < 1.8 {
            eprintln!(
                "Skipping frame {} (diff={:.2}) -- too similar to previous",
                idx + 1,
                frame_diff
            );
            skipped_frames += 1;
            continue;
        }

        match find_best_overlap(&prev_frame, frame) {
            Ok((overlap, _)) => {
                let slice_height = frame.height().saturating_sub(overlap);
                if slice_height < 10 {
                    eprintln!("Skipping frame {} -- insufficient new content", idx + 1);
                    skipped_frames += 1;
                    continue;
                }

                let cropped =
                    image::imageops::crop_imm(frame, 0, overlap, frame.width(), slice_height)
                        .to_image();
                pieces.push(cropped);
                prev_frame = frame.clone();
            }
            Err(e) => {
                eprintln!("Skipping frame {} -- overlap detection failed: {}", idx + 1, e);
                skipped_frames += 1;
            }
        }
    }

    let used_frames = pieces.len();
    if used_frames < 2 {
        return Err(
            "Not enough unique frames after filtering similar ones. Scroll further between captures."
                .to_string(),
        );
    }

    let final_height: u32 = pieces.iter().map(|p| p.height()).sum();
    let mut result = image::RgbaImage::new(width, final_height);
    let mut y_offset = 0;
    for piece in pieces {
        image::imageops::replace(&mut result, &piece, 0, y_offset as i64);
        y_offset += piece.height();
    }

    let dest = ensure_save_dir(&save_dir)?;
    let filename = generate_filename("scrollshot", "png")?;
    let output_path = dest.join(filename);
    result
        .save(&output_path)
        .map_err(|e| format!("Failed to save stitched image: {}", e))?;

    let path = output_path
        .to_str()
        .ok_or_else(|| "Failed to encode stitched file path".to_string())?
        .to_string();

    Ok(StitchResult {
        path,
        total_frames,
        used_frames,
        skipped_frames,
        final_height,
    })
}

#[tauri::command]
pub async fn stitch_scroll_frames_preview(
    frame_paths: Vec<String>,
    session_dir: String,
) -> Result<String, String> {
    if frame_paths.is_empty() {
        return Err("No frames available for preview".to_string());
    }

    let capped_paths = if frame_paths.len() > MAX_SCROLL_FRAMES {
        frame_paths[frame_paths.len().saturating_sub(MAX_SCROLL_FRAMES)..].to_vec()
    } else {
        frame_paths
    };

    let mut loaded_frames = Vec::with_capacity(capped_paths.len());
    for path in &capped_paths {
        let frame = image::open(path)
            .map_err(|e| format!("Failed to open frame '{}': {}", path, e))?
            .to_rgba8();
        loaded_frames.push(frame);
    }

    let width = loaded_frames[0].width();
    let height = loaded_frames[0].height();
    if width < 20 || height < 20 {
        return Err("Captured frame is too small".to_string());
    }

    for frame in loaded_frames.iter().skip(1) {
        if frame.width() != width || frame.height() != height {
            return Err("Scroll frames have different dimensions".to_string());
        }
    }

    let mut pieces: Vec<image::RgbaImage> = vec![loaded_frames[0].clone()];
    let mut prev_frame = loaded_frames[0].clone();

    for frame in loaded_frames.iter().skip(1) {
        let frame_diff = sample_frame_difference(&prev_frame, frame);
        if frame_diff < 1.8 {
            continue;
        }

        match find_best_overlap(&prev_frame, frame) {
            Ok((overlap, _)) => {
                let slice_height = frame.height().saturating_sub(overlap);
                if slice_height < 10 {
                    continue;
                }

                let cropped =
                    image::imageops::crop_imm(frame, 0, overlap, frame.width(), slice_height)
                        .to_image();
                pieces.push(cropped);
                prev_frame = frame.clone();
            }
            Err(_) => {
                continue;
            }
        }
    }

    if pieces.len() == 1 {
        if let Some(last_frame) = loaded_frames.last() {
            pieces = vec![last_frame.clone()];
        }
    }

    let final_height: u32 = pieces.iter().map(|p| p.height()).sum();
    let mut result = image::RgbaImage::new(width, final_height);
    let mut y_offset = 0;
    for piece in pieces {
        image::imageops::replace(&mut result, &piece, 0, y_offset as i64);
        y_offset += piece.height();
    }

    let preview_dir = PathBuf::from(&session_dir).join("preview");
    fs::create_dir_all(&preview_dir)
        .map_err(|e| format!("Failed to create preview directory: {}", e))?;
    let preview_path = preview_dir.join("scroll-preview.png");

    result
        .save(&preview_path)
        .map_err(|e| format!("Failed to save preview image: {}", e))?;

    preview_path
        .to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| "Failed to encode preview file path".to_string())
}

#[tauri::command]
pub async fn cleanup_scroll_temp(session_dir: String) -> Result<(), String> {
    if session_dir.trim().is_empty() {
        return Ok(());
    }
    let path = Path::new(&session_dir);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(path).map_err(|e| format!("Failed to clean scroll temp directory: {}", e))
}

/// Capture region and perform OCR, copying text to clipboard
#[tauri::command]
pub async fn native_capture_ocr_region(save_dir: String) -> Result<String, String> {
    {
        let _lock = SCREENCAPTURE_LOCK
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        if is_screencapture_running() {
            return Err("Another screenshot capture is already in progress".to_string());
        }

        check_and_activate_permission().map_err(map_permission_check_error)?;
    }

    let filename = generate_filename("ocr_temp", "png")?;
    let save_path = PathBuf::from(&save_dir);
    std::fs::create_dir_all(&save_path)
        .map_err(|e| format!("Failed to create save directory '{}': {}", save_dir, e))?;
    let screenshot_path = save_path.join(&filename);
    let path_str = screenshot_path.to_string_lossy().to_string();

    let child = Command::new("screencapture")
        .arg("-i")
        .arg("-x")
        .arg(&path_str)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for screencapture: {}", e))?;

    if !output.status.success() {
        if screenshot_path.exists() {
            let _ = std::fs::remove_file(&screenshot_path);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_permission_error(&stderr) {
            return Err(permission_required_error());
        }
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.is_empty() {
            return Err("cancelled:Screenshot was cancelled or failed".to_string());
        }
        return Err(format!(
            "command_failed:Screenshot command failed: {}",
            stderr_trimmed
        ));
    }

    if !screenshot_path.exists() {
        return Err("cancelled:Screenshot was cancelled or failed".to_string());
    }

    let recognized_text = match recognize_text_from_image(&path_str) {
        Ok(text) => text,
        Err(e) => {
            let _ = std::fs::remove_file(&screenshot_path);
            return Err(format!("OCR failed: {}", e));
        }
    };

    let recognized_text = recognized_text.trim().to_string();
    if recognized_text.is_empty() {
        let _ = std::fs::remove_file(&screenshot_path);
        return Err("No text recognized in selected region".to_string());
    }

    if let Err(e) = copy_text_to_clipboard(&recognized_text) {
        let _ = std::fs::remove_file(&screenshot_path);
        return Err(format!("Failed to copy text to clipboard: {}", e));
    }

    play_screenshot_sound().await.ok();

    let _ = std::fs::remove_file(&screenshot_path);

    Ok(recognized_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_frame(width: u32, height: u32, start: u32) -> image::RgbaImage {
        let mut img = image::RgbaImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                let value = ((start + y + x / 3) % 255) as u8;
                img.put_pixel(x, y, image::Rgba([value, value / 2, 255 - value, 255]));
            }
        }
        img
    }

    #[test]
    fn sample_frame_difference_detects_identical_frame() {
        let frame1 = build_frame(120, 180, 0);
        let frame2 = build_frame(120, 180, 0);
        let diff = sample_frame_difference(&frame1, &frame2);
        assert!(diff < 0.5);
    }

    #[test]
    fn find_best_overlap_detects_scroll_delta() {
        let frame1 = build_frame(160, 240, 0);
        let scroll_delta = 80;
        let frame2 = build_frame(160, 240, scroll_delta);
        let (overlap, err) = find_best_overlap(&frame1, &frame2).expect("overlap should be found");
        assert!((overlap as i32 - (240 - scroll_delta) as i32).abs() <= 8);
        assert!(err < MAX_SCROLL_MATCH_ERROR);
    }

    #[test]
    fn permission_error_recognizes_display_creation_failure() {
        assert!(is_permission_error("could not create image from display"));
    }

    #[test]
    fn map_permission_error_avoids_double_command_prefix() {
        let mapped = map_permission_check_error(
            "command_failed:Screen Recording check failed (exit code: 1)".to_string(),
        );
        assert_eq!(
            mapped,
            "command_failed:Screen Recording check failed (exit code: 1)"
        );
    }
}
