// Tauri command layer. Dispatches to the local backend (monitor in-process,
// when already elevated) or the remote one (elevated helper over the pipe).
use crate::ipc::PipeClient;
use crate::monitor::MonitorState;
use serde_json::Value;
use tauri::State;

pub enum Backend {
    Local(MonitorState),
    Remote(PipeClient),
}

#[tauri::command]
pub fn get_snapshot(backend: State<Backend>) -> Value {
    match backend.inner() {
        Backend::Local(s) => serde_json::to_value(s.snapshot()).unwrap_or(Value::Null),
        Backend::Remote(c) => c.snapshot(),
    }
}

#[tauri::command]
pub fn kill_process(backend: State<Backend>, pid: u32) -> Result<(), String> {
    match backend.inner() {
        Backend::Local(_) => crate::monitor::control::kill_process(pid),
        Backend::Remote(c) => c.kill(pid),
    }
}

#[tauri::command]
pub fn kill_process_tree(backend: State<Backend>, pid: u32) -> Result<(), String> {
    match backend.inner() {
        Backend::Local(_) => crate::monitor::control::kill_process_tree(pid),
        Backend::Remote(c) => c.kill_tree(pid),
    }
}

#[tauri::command]
pub fn suspend_process(backend: State<Backend>, pid: u32) -> Result<(), String> {
    match backend.inner() {
        Backend::Local(_) => crate::monitor::control::suspend_process(pid),
        Backend::Remote(c) => c.suspend(pid),
    }
}

#[tauri::command]
pub fn resume_process(backend: State<Backend>, pid: u32) -> Result<(), String> {
    match backend.inner() {
        Backend::Local(_) => crate::monitor::control::resume_process(pid),
        Backend::Remote(c) => c.resume(pid),
    }
}

#[tauri::command]
pub fn get_icon(backend: State<Backend>, path: String) -> Option<String> {
    match backend.inner() {
        Backend::Local(_) => crate::monitor::icons::get_icon(path),
        Backend::Remote(c) => c.icon(path),
    }
}

// Shut down the elevated helper before an update installs, so it stops holding
// the .exe open (the unelevated installer can't kill an elevated process).
#[tauri::command]
pub fn shutdown_helper(backend: State<Backend>) {
    if let Backend::Remote(c) = backend.inner() {
        let _ = c.shutdown();
    }
}
