mod commands;
mod ipc;
mod monitor;

use commands::Backend;
use monitor::MonitorState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

fn arg_value(args: &[String], key: &str) -> Option<String> {
    let i = args.iter().position(|a| a == key)?;
    args.get(i + 1).cloned()
}

// Floating widget window, logical size (compact metrics + process list).
const WIDGET_W: f64 = 300.0;
const WIDGET_H: f64 = 480.0;

// Create the widget window near the top-right of the primary monitor.
fn build_widget(app: &tauri::AppHandle) {
    let (x, y) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let w = m.size().width as f64 / m.scale_factor();
            ((w - WIDGET_W - 24.0).max(0.0), 48.0)
        })
        .unwrap_or((48.0, 48.0));
    let _ = WebviewWindowBuilder::new(
        app,
        "widget",
        WebviewUrl::App("index.html?view=widget".into()),
    )
    .title("ResmonX Widget")
    .inner_size(WIDGET_W, WIDGET_H)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .min_inner_size(240.0, 200.0)
    .resizable(true)
    .shadow(false)
    .build();
}

// Toggle the floating widget: create on first use, then show/hide.
#[tauri::command]
fn toggle_widget(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("widget") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
        return;
    }
    build_widget(&app);
}

// Bring the main window forward and switch it to the given tab.
#[tauri::command]
fn open_main_tab(app: tauri::AppHandle, tab: String) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    let _ = app.emit("switch-tab", tab);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // Helper mode (elevated, no window): serves the monitoring over the pipe.
    if args.iter().any(|a| a == "--helper") {
        if let (Some(pipe), Some(parent)) = (
            arg_value(&args, "--pipe"),
            arg_value(&args, "--parent").and_then(|p| p.parse::<u32>().ok()),
        ) {
            ipc::run_server(&pipe, parent);
        }
        return;
    }

    // Self-heal: remove a stale RUNASADMIN layer on our .exe (from an old
    // version that self-elevated) that would force the window to high
    // integrity, which Target Mode won't light. Takes effect on the next launch.
    ipc::clear_own_runasadmin_layer();

    // UI mode. If already elevated (e.g. dev in an admin terminal), monitor
    // in-process. Otherwise spawn the elevated helper and talk over the pipe; if
    // the user cancels the UAC prompt, fall back to local unelevated (no ETW).
    let backend = if ipc::is_elevated() {
        Backend::Local(MonitorState::new())
    } else {
        let pipe = ipc::gen_pipe_name();
        // spawn the elevated helper and connect; if UAC is cancelled or it
        // can't connect, fall back to local unelevated (everything but ETW)
        match ipc::spawn_helper_elevated(&pipe, std::process::id()) {
            Ok(helper_pid) => match ipc::PipeClient::connect(&pipe, helper_pid) {
                Some(c) => Backend::Remote(c),
                None => Backend::Local(MonitorState::new()),
            },
            Err(_) => Backend::Local(MonitorState::new()),
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(backend)
        .on_window_event(|window, event| {
            // Closing the main window minimizes to tray instead of quitting;
            // "Salir" in the tray is the only real exit.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Tray: toggle widget, restore main, quit.
            let widget_i =
                MenuItem::with_id(app, "widget", "Mostrar/ocultar widget", true, None::<&str>)?;
            let main_i =
                MenuItem::with_id(app, "show_main", "Mostrar ResmonX", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&widget_i, &main_i, &sep, &quit_i])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ResmonX")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "widget" => toggle_widget(app.clone()),
                    "show_main" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::kill_process,
            commands::kill_process_tree,
            commands::suspend_process,
            commands::resume_process,
            commands::get_icon,
            toggle_widget,
            open_main_tab,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
