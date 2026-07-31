use std::collections::HashMap;
use std::net::Ipv4Addr;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, SetTcpEntry, MIB_TCPROW_LH, MIB_TCPROW_LH_0, MIB_TCPROW_OWNER_PID,
    MIB_TCPTABLE_OWNER_PID, MIB_TCP_STATE_DELETE_TCB, MIB_TCP_STATE_LISTEN,
    TCP_TABLE_OWNER_PID_ALL,
};
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

// --------------------------------------------------------------------------
// TCP connections. SetTcpEntry is IPv4-only (there is no public IPv6 twin), so
// IPv6 rows can't be closed.
// --------------------------------------------------------------------------

const AF_INET4: u32 = 2;

/// The IPv4 TCP table with owning PIDs.
fn tcp_table() -> Vec<MIB_TCPROW_OWNER_PID> {
    unsafe {
        let mut size = 0u32;
        // first call only sizes the buffer
        GetExtendedTcpTable(None, &mut size, false, AF_INET4, TCP_TABLE_OWNER_PID_ALL, 0);
        if size == 0 {
            return Vec::new();
        }
        // u32 buffer so the MIB struct's alignment is satisfied
        let mut buf = vec![0u32; (size as usize + 3) / 4];
        let rc = GetExtendedTcpTable(
            Some(buf.as_mut_ptr().cast()),
            &mut size,
            false,
            AF_INET4,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if rc != 0 {
            return Vec::new();
        }
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize).to_vec()
    }
}

/// Same "ip:port" shape net.rs sends to the UI, so rows map back to table rows.
fn addr(a: u32, p: u32) -> String {
    format!("{}:{}", Ipv4Addr::from(u32::from_be(a)), u16::from_be(p as u16))
}

fn remote_ip(r: &MIB_TCPROW_OWNER_PID) -> Ipv4Addr {
    Ipv4Addr::from(u32::from_be(r.dwRemoteAddr))
}

/// A listener has no TCB to delete.
fn established(r: &MIB_TCPROW_OWNER_PID) -> bool {
    r.dwState != MIB_TCP_STATE_LISTEN.0 as u32
}

fn delete_tcb(r: &MIB_TCPROW_OWNER_PID) -> bool {
    let row = MIB_TCPROW_LH {
        Anonymous: MIB_TCPROW_LH_0 {
            State: MIB_TCP_STATE_DELETE_TCB,
        },
        dwLocalAddr: r.dwLocalAddr,
        dwLocalPort: r.dwLocalPort,
        dwRemoteAddr: r.dwRemoteAddr,
        dwRemotePort: r.dwRemotePort,
    };
    unsafe { SetTcpEntry(&row) == 0 }
}

/// Closes one connection, identified the way the UI shows it. Looking the row up
/// in the live table avoids trusting addresses parsed in the frontend.
pub fn close_connection(pid: u32, local: &str, remote: &str) -> Result<(), String> {
    let row = tcp_table().into_iter().find(|r| {
        r.dwOwningPid == pid
            && established(r)
            && addr(r.dwLocalAddr, r.dwLocalPort) == local
            && addr(r.dwRemoteAddr, r.dwRemotePort) == remote
    });
    let Some(row) = row else {
        return Err("la conexión ya no existe (solo se admite TCP sobre IPv4)".into());
    };
    if delete_tcb(&row) {
        Ok(())
    } else {
        Err("Windows rechazó cerrar la conexión".into())
    }
}

/// Closes every TCP connection of a process; returns how many were closed.
pub fn close_process_connections(pid: u32) -> usize {
    tcp_table()
        .iter()
        .filter(|r| r.dwOwningPid == pid && established(r))
        .filter(|r| delete_tcb(r))
        .count()
}

/// Closes every TCP connection whose remote address is `ip`.
pub fn close_remote_connections(ip: &str) -> usize {
    tcp_table()
        .iter()
        .filter(|r| established(r) && remote_ip(r).to_string() == ip)
        .filter(|r| delete_tcb(r))
        .count()
}
