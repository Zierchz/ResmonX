use serde::Serialize;
use windows::Win32::System::Services::{
    CloseServiceHandle, EnumServicesStatusExW, OpenSCManagerW, ENUM_SERVICE_STATUS_PROCESSW,
    SC_ENUM_PROCESS_INFO, SC_MANAGER_ENUMERATE_SERVICE, SERVICE_STATE_ALL, SERVICE_WIN32,
};

#[derive(Serialize)]
pub struct ServiceSnapshot {
    pub name: String,
    pub display: String,
    pub pid: u32,
    pub state: String,
}

fn state_str(state: u32) -> String {
    match state {
        1 => "Detenido",
        2 => "Iniciando",
        3 => "Deteniéndose",
        4 => "En ejecución",
        5 => "Reanudando",
        6 => "Pausando",
        7 => "En pausa",
        _ => "?",
    }
    .into()
}

pub fn collect() -> Vec<ServiceSnapshot> {
    unsafe {
        let Ok(scm) = OpenSCManagerW(None, None, SC_MANAGER_ENUMERATE_SERVICE) else {
            return Vec::new();
        };
        let mut needed = 0u32;
        let mut count = 0u32;
        let mut resume = 0u32;
        // primera llamada solo para conocer el tamaño del buffer
        let _ = EnumServicesStatusExW(
            scm,
            SC_ENUM_PROCESS_INFO,
            SERVICE_WIN32,
            SERVICE_STATE_ALL,
            None,
            &mut needed,
            &mut count,
            Some(&mut resume),
            None,
        );
        let mut buf = vec![0u8; needed as usize];
        resume = 0;
        let mut out = Vec::new();
        if EnumServicesStatusExW(
            scm,
            SC_ENUM_PROCESS_INFO,
            SERVICE_WIN32,
            SERVICE_STATE_ALL,
            Some(&mut buf),
            &mut needed,
            &mut count,
            Some(&mut resume),
            None,
        )
        .is_ok()
        {
            let entries = std::slice::from_raw_parts(
                buf.as_ptr() as *const ENUM_SERVICE_STATUS_PROCESSW,
                count as usize,
            );
            for e in entries {
                out.push(ServiceSnapshot {
                    name: e.lpServiceName.to_string().unwrap_or_default(),
                    display: e.lpDisplayName.to_string().unwrap_or_default(),
                    pid: e.ServiceStatusProcess.dwProcessId,
                    state: state_str(e.ServiceStatusProcess.dwCurrentState.0),
                });
            }
        }
        let _ = CloseServiceHandle(scm);
        out
    }
}
