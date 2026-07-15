mod commands;
mod ipc;
mod monitor;

use commands::Backend;
use monitor::MonitorState;

fn arg_value(args: &[String], key: &str) -> Option<String> {
    let i = args.iter().position(|a| a == key)?;
    args.get(i + 1).cloned()
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
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::kill_process,
            commands::kill_process_tree,
            commands::suspend_process,
            commands::resume_process,
            commands::get_icon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
