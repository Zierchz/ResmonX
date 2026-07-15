use std::collections::HashMap;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, Thread32First, Thread32Next,
    PROCESSENTRY32W, TH32CS_SNAPPROCESS, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::Threading::{
    OpenProcess, OpenThread, ResumeThread, SuspendThread, TerminateProcess, PROCESS_TERMINATE,
    THREAD_SUSPEND_RESUME,
};

/// Child->parent map of all processes (Toolhelp).
fn parent_map() -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return map;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                map.insert(e.th32ProcessID, e.th32ParentProcessID);
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    map
}

/// Descendants of `root` (excluding it).
fn descendants(root: u32) -> Vec<u32> {
    let parents = parent_map();
    let mut out = Vec::new();
    // breadth-first traversal avoiding cycles from PID recycling
    let mut frontier = vec![root];
    while let Some(pid) = frontier.pop() {
        for (&child, &parent) in &parents {
            if parent == pid && child != root && !out.contains(&child) {
                out.push(child);
                frontier.push(child);
            }
        }
    }
    out
}

fn terminate(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("PID inválido".into());
    }
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid)
            .map_err(|e| format!("no se pudo abrir el proceso {pid}: {e}"))?;
        let result = TerminateProcess(handle, 1).map_err(|e| e.to_string());
        let _ = CloseHandle(handle);
        result
    }
}

/// Suspends or resumes all threads of a process.
fn set_suspended(pid: u32, suspend: bool) -> Result<(), String> {
    if pid == 0 {
        return Err("PID inválido".into());
    }
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
            .map_err(|e| format!("snapshot de hilos falló: {e}"))?;
        let mut e = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut touched = 0u32;
        if Thread32First(snap, &mut e).is_ok() {
            loop {
                if e.th32OwnerProcessID == pid {
                    if let Ok(th) = OpenThread(THREAD_SUSPEND_RESUME, false, e.th32ThreadID) {
                        if suspend {
                            SuspendThread(th);
                        } else {
                            ResumeThread(th);
                        }
                        touched += 1;
                        let _ = CloseHandle(th);
                    }
                }
                if Thread32Next(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        if touched == 0 {
            return Err(format!("sin hilos accesibles para el proceso {pid}"));
        }
        Ok(())
    }
}

pub fn kill_process(pid: u32) -> Result<(), String> {
    terminate(pid)
}

pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // children first, root last
    for child in descendants(pid) {
        let _ = terminate(child);
    }
    terminate(pid)
}

pub fn suspend_process(pid: u32) -> Result<(), String> {
    set_suspended(pid, true)
}

pub fn resume_process(pid: u32) -> Result<(), String> {
    set_suspended(pid, false)
}
