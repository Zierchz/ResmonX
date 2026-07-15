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

    // Modo ayudante (elevado, sin ventana): sirve el monitoreo por el pipe.
    if args.iter().any(|a| a == "--helper") {
        if let (Some(pipe), Some(parent)) = (
            arg_value(&args, "--pipe"),
            arg_value(&args, "--parent").and_then(|p| p.parse::<u32>().ok()),
        ) {
            ipc::run_server(&pipe, parent);
        }
        return;
    }

    // Modo UI. Si ya estamos elevados (p. ej. dev en terminal admin), se
    // monitorea en proceso. Si no, se lanza el ayudante elevado y se habla por
    // el pipe; si el usuario cancela el UAC, cae a local sin elevar (sin ETW).
    let backend = if ipc::is_elevated() {
        Backend::Local(MonitorState::new())
    } else {
        let pipe = ipc::gen_pipe_name();
        // lanza el ayudante elevado y conecta; si cancela el UAC o no conecta,
        // cae a local sin elevar (funciona todo menos ETW)
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
