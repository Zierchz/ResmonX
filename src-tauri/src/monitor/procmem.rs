// Working set por PID vía NtQuerySystemInformation.
// sysinfo no puede leer la memoria de ciertos procesos protegidos (p.ej. vmmemWSL, la VM de WSL2)
// y devuelve 0; esta consulta a nivel de sistema sí los reporta, como el Administrador de tareas.
use std::collections::HashMap;
use windows::Wdk::System::SystemInformation::{NtQuerySystemInformation, SystemProcessInformation};
use windows::Win32::Foundation::STATUS_INFO_LENGTH_MISMATCH;
use windows::Win32::System::WindowsProgramming::SYSTEM_PROCESS_INFORMATION;

// mapa pid -> working set en bytes
pub fn working_sets() -> HashMap<u32, u64> {
    let mut map = HashMap::new();
    unsafe {
        // primera llamada para conocer el tamaño necesario
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
            // el conjunto de procesos crecio entre llamadas: agranda y reintenta
            if st == STATUS_INFO_LENGTH_MISMATCH {
                buf = vec![0u8; len as usize + 65536];
                continue;
            }
            if st.is_err() {
                return map;
            }
            break;
        }

        // lista enlazada de SYSTEM_PROCESS_INFORMATION vía NextEntryOffset
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
