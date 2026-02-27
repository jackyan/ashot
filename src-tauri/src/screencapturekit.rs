use std::fs;
use std::path::PathBuf;
use std::process::Command;

use image::imageops::crop_imm;
use tauri::AppHandle;
use tauri_plugin_screenshots::get_monitor_screenshot;
use xcap::Monitor;

use crate::utils::generate_filename;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScrollCaptureBackend {
    ScreenCaptureKit,
    ScreencaptureCli,
}

#[derive(Debug, Clone, Copy)]
pub struct CaptureRectInput {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
struct MonitorGeometry {
    id: u32,
    logical_x: f32,
    logical_y: f32,
    logical_width: f32,
    logical_height: f32,
    scale: f32,
}

pub fn preferred_scroll_capture_backend() -> ScrollCaptureBackend {
    #[cfg(target_os = "macos")]
    {
        if let Some(major) = macos_major_version() {
            if major >= 14 {
                return ScrollCaptureBackend::ScreenCaptureKit;
            }
        }
    }
    ScrollCaptureBackend::ScreencaptureCli
}

#[cfg(target_os = "macos")]
fn macos_major_version() -> Option<u32> {
    let output = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut parts = raw.trim().split('.');
    parts.next()?.parse::<u32>().ok()
}

fn load_monitor_geometry() -> Result<Vec<MonitorGeometry>, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to query monitors: {}", e))?;
    let mut geometry = Vec::with_capacity(monitors.len());

    for monitor in monitors {
        let id = monitor
            .id()
            .map_err(|e| format!("Failed to get monitor id: {}", e))?;
        let x = monitor
            .x()
            .map_err(|e| format!("Failed to get monitor x for {}: {}", id, e))?;
        let y = monitor
            .y()
            .map_err(|e| format!("Failed to get monitor y for {}: {}", id, e))?;
        let width = monitor
            .width()
            .map_err(|e| format!("Failed to get monitor width for {}: {}", id, e))?;
        let height = monitor
            .height()
            .map_err(|e| format!("Failed to get monitor height for {}: {}", id, e))?;
        let scale = monitor
            .scale_factor()
            .map_err(|e| format!("Failed to get monitor scale factor for {}: {}", id, e))?;

        geometry.push(MonitorGeometry {
            id,
            logical_x: x as f32 / scale,
            logical_y: y as f32 / scale,
            logical_width: width as f32 / scale,
            logical_height: height as f32 / scale,
            scale,
        });
    }

    Ok(geometry)
}

fn resolve_target_monitor(
    rect: CaptureRectInput,
    monitors: &[MonitorGeometry],
) -> Option<MonitorGeometry> {
    let center_x = rect.x as f32 + rect.width as f32 / 2.0;
    let center_y = rect.y as f32 + rect.height as f32 / 2.0;

    monitors.iter().copied().find(|monitor| {
        center_x >= monitor.logical_x
            && center_x < monitor.logical_x + monitor.logical_width
            && center_y >= monitor.logical_y
            && center_y < monitor.logical_y + monitor.logical_height
    })
}

pub async fn capture_rect_frame_screen_capture_kit(
    app_handle: AppHandle,
    rect: CaptureRectInput,
    save_dir: &str,
) -> Result<String, String> {
    let monitor_geometry = load_monitor_geometry()?;
    let target = resolve_target_monitor(rect, &monitor_geometry)
        .ok_or_else(|| "capture_failed:Selected area is outside available monitors".to_string())?;

    let monitor_image_path = get_monitor_screenshot(app_handle, target.id)
        .await
        .map_err(|e| format!("capture_failed:Failed to capture monitor image: {}", e))?;

    let result = (|| -> Result<String, String> {
        let monitor_image = image::open(&monitor_image_path)
            .map_err(|e| format!("capture_failed:Failed to read monitor image: {}", e))?
            .to_rgba8();

        let rel_x = rect.x as f32 - target.logical_x;
        let rel_y = rect.y as f32 - target.logical_y;

        let crop_x = (rel_x * target.scale).max(0.0).round() as u32;
        let crop_y = (rel_y * target.scale).max(0.0).round() as u32;
        let crop_w = (rect.width as f32 * target.scale).max(1.0).round() as u32;
        let crop_h = (rect.height as f32 * target.scale).max(1.0).round() as u32;

        if crop_x >= monitor_image.width() || crop_y >= monitor_image.height() {
            return Err("capture_failed:Selected area is outside monitor bounds".to_string());
        }

        let max_w = monitor_image.width().saturating_sub(crop_x);
        let max_h = monitor_image.height().saturating_sub(crop_y);
        let final_w = crop_w.min(max_w);
        let final_h = crop_h.min(max_h);

        if final_w < 10 || final_h < 10 {
            return Err("capture_failed:Selected area is too small".to_string());
        }

        fs::create_dir_all(save_dir)
            .map_err(|e| format!("capture_failed:Failed to create save directory: {}", e))?;
        let filename = generate_filename("scroll_frame", "png")?;
        let output_path = PathBuf::from(save_dir).join(filename);

        let cropped = crop_imm(&monitor_image, crop_x, crop_y, final_w, final_h).to_image();
        cropped
            .save(&output_path)
            .map_err(|e| format!("capture_failed:Failed to save scroll frame: {}", e))?;

        output_path
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "capture_failed:Failed to encode output path".to_string())
    })();

    let _ = fs::remove_file(monitor_image_path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_backend_on_non_macos() {
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(
                preferred_scroll_capture_backend(),
                ScrollCaptureBackend::ScreencaptureCli
            );
        }
    }
}
