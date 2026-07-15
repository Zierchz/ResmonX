// Working set per PID via NtQuerySystemInformation.
// sysinfo can't read the memory of certain protected processes (e.g. vmmemWSL, the WSL2 VM)
// and returns 0; this system-level query does report them, like Task Manager.
use std::collections::HashMap;
use windows::Wdk::System::SystemInformation::{NtQuerySystemInformation, SystemProcessInformation};
use windows::Win32::Foundation::STATUS_INFO_LENGTH_MISMATCH;
use windows::Win32::System::WindowsProgramming::SYSTEM_PROCESS_INFORMATION;

// pid -> working set in bytes map
pub fn working_sets() -> HashMap<u32, u64> {
    let mut map = HashMap::new();
    unsafe {
        // first call to learn the needed size
        let mut len = 0u32;
        let _ = NtQuerySystemInformation(SystemProcessInformation, std::ptr::null_mut(), 0, &mut len);

        let mut buf = vec![0u8; len as usize + 65536];
        loop {
            let st = NtQuerySystemInformation(
                SystemProcessInformation,
                buf.as_mut_ptr() as *mut core::ffi::c_void,
                buf.len() as u32,
                &mut len,
            );
            // the process set grew between calls: enlarge and retry
            if st == STATUS_INFO_LENGTH_MISMATCH {
                buf = vec![0u8; len as usize + 65536];
                continue;
            }
            if st.is_err() {
                return map;
            }
            break;
        }

        // linked list of SYSTEM_PROCESS_INFORMATION via NextEntryOffset
        let stride = std::mem::size_of::<SYSTEM_PROCESS_INFORMATION>();
        let mut off = 0usize;
        while off + stride <= buf.len() {
            let info = &*(buf.as_ptr().add(off) as *const SYSTEM_PROCESS_INFORMATION);
            let pid = info.UniqueProcessId.0 as usize as u32;
            map.insert(pid, info.WorkingSetSize as u64);
            if info.NextEntryOffset == 0 {
                break;
            }
            off += info.NextEntryOffset as usize;
        }
    }
    map
}
