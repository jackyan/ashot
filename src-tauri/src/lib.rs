//! BetterShot - A screenshot capture and editing application
//!
//! This crate provides the Tauri backend for capturing, editing,
//! and saving screenshots with various features like region selection
//! and background customization.

mod clipboard;
mod commands;
mod image;
mod ocr;
mod screencapturekit;
mod screenshot;
mod utils;

use commands::{
    capture_all_monitors, capture_once, capture_rect_frame, capture_rect_ocr, capture_region,
    check_screen_permission, cleanup_scroll_temp, copy_image_file_to_clipboard,
    get_desktop_directory, get_mouse_position, get_temp_directory, list_capture_windows,
    move_window_to_active_space, native_capture_fullscreen, native_capture_interactive,
    native_capture_ocr_region, native_capture_window, open_screen_recording_settings,
    play_screenshot_sound, poll_scroll_region, render_image_with_effects_rust,
    request_screen_permission, reset_scroll_monitor, save_edited_image,
    set_main_window_mouse_passthrough, stitch_scroll_frames, stitch_scroll_frames_preview,
    validate_save_directory,
};

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

fn is_hidden_launch() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

/// Shows the main application window (creates it if needed, shows if hidden)
fn show_main_window(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);
        let _ = window.set_always_on_top(false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("ashot")
            .inner_size(1200.0, 800.0)
            .min_inner_size(640.0, 520.0)
            .center()
            .resizable(true)
            .decorations(true)
            .visible(true)
            .build()?;

        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Err(e) = window_clone.hide() {
                    eprintln!("Failed to hide window: {}", e);
                }
                api.prevent_close();
            }
        });

        let _ = window.set_focus();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Err(e) = show_main_window(app) {
                eprintln!("Failed to show window from second instance: {}", e);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};

            // Enable autostart by default only for release builds.
            // In dev/debug this can create hidden background agents that keep
            // global shortcuts active after closing the terminal session.
            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart_manager = app.autolaunch();
                // Only enable if not already enabled (don't override user preference)
                if !autostart_manager.is_enabled().unwrap_or(false) {
                    let _ = autostart_manager.enable();
                }
            }

            let launch_hidden = is_hidden_launch();
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("ashot")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(640.0, 520.0)
                    .center()
                    .resizable(true)
                    .decorations(true)
                    .visible(!launch_hidden)
                    .build()?;

            // Handle close request - hide instead of quit
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if let Err(e) = window_clone.hide() {
                        eprintln!("Failed to hide window: {}", e);
                    }
                    api.prevent_close();
                }
            });

            let open_item = MenuItemBuilder::with_id("open", "Open ashot").build(app)?;

            let capture_region_item =
                MenuItemBuilder::with_id("capture_region", "Capture Region").build(app)?;

            let capture_screen_item =
                MenuItemBuilder::with_id("capture_screen", "Capture Screen").build(app)?;

            let capture_window_item =
                MenuItemBuilder::with_id("capture_window", "Capture Window").build(app)?;

            let capture_ocr_item =
                MenuItemBuilder::with_id("capture_ocr", "OCR Region").build(app)?;

            let preferences_item = MenuItemBuilder::with_id("preferences", "Preferences...")
                .accelerator("CommandOrControl+,")
                .build(app)?;

            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CommandOrControl+Q")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &open_item,
                    &PredefinedMenuItem::separator(app)?,
                    &capture_region_item,
                    &capture_screen_item,
                    &capture_window_item,
                    &capture_ocr_item,
                    &PredefinedMenuItem::separator(app)?,
                    &preferences_item,
                    &PredefinedMenuItem::separator(app)?,
                    &quit_item,
                ])
                .build()?;
            let _tray = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("ashot")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        }
                    }
                    "capture_region" => {
                        let _ = app.emit("capture-triggered", ());
                    }
                    "capture_screen" => {
                        let _ = app.emit("capture-fullscreen", ());
                    }
                    "capture_window" => {
                        let _ = app.emit("capture-window", ());
                    }
                    "capture_ocr" => {
                        let _ = app.emit("capture-ocr", ());
                    }
                    "preferences" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        } else {
                            let _ = app.emit("open-preferences", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_once,
            capture_all_monitors,
            capture_rect_frame,
            capture_rect_ocr,
            capture_region,
            check_screen_permission,
            request_screen_permission,
            open_screen_recording_settings,
            list_capture_windows,
            poll_scroll_region,
            reset_scroll_monitor,
            save_edited_image,
            stitch_scroll_frames,
            stitch_scroll_frames_preview,
            cleanup_scroll_temp,
            validate_save_directory,
            render_image_with_effects_rust,
            get_desktop_directory,
            get_temp_directory,
            native_capture_interactive,
            native_capture_fullscreen,
            native_capture_window,
            native_capture_ocr_region,
            play_screenshot_sound,
            get_mouse_position,
            move_window_to_active_space,
            set_main_window_mouse_passthrough,
            copy_image_file_to_clipboard
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::Reopen { .. } | RunEvent::Opened { .. } => {
            if let Err(e) = show_main_window(app_handle) {
                eprintln!("Failed to show window on app activation: {}", e);
            }
        }
        _ => {}
    });
}
