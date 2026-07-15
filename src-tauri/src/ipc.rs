// Split UI/ayudante: la ventana corre sin elevar (para que Modo Objetivo de
// ASUS la ilumine) y un ayudante elevado hace el monitoreo por un named pipe.
use crate::monitor::{control, icons, MonitorState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::sync::Mutex;
use std::time::Duration;
use windows::core::{GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, LocalFree, ERROR_PIPE_CONNECTED, HANDLE, HLOCAL, INVALID_HANDLE_VALUE,
};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{
    GetTokenInformation, TokenElevation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
    TOKEN_ELEVATION, TOKEN_QUERY,
};
use windows::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX};
use windows::Win32::System::Com::{CoCreateGuid, CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId,
    GetNamedPipeServerProcessId, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
    PIPE_WAIT,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetProcessId, OpenProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
    PROCESS_SYNCHRONIZE,
};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

// Protocolo del pipe: una petición y una respuesta por línea (JSON compacto).
#[derive(Serialize, Deserialize)]
enum Req {
    Snapshot,
    Kill(u32),
    KillTree(u32),
    Suspend(u32),
    Resume(u32),
    Icon(String),
}

#[derive(Serialize, Deserialize)]
enum Resp {
    Snapshot(Value),
    Action(Result<(), String>),
    Icon(Option<String>),
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// True si el proceso actual está elevado (token con elevación).
pub fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        );
        let _ = CloseHandle(token);
        ok.is_ok() && elevation.TokenIsElevated != 0
    }
}

/// Nombre de pipe aleatorio (GUID criptográfico) para que no sea predecible.
pub fn gen_pipe_name() -> String {
    let guid = unsafe { CoCreateGuid() }.unwrap_or_else(|_| GUID::zeroed());
    let tail: String = guid.data4.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        r"\\.\pipe\resmonx-{:08x}{:04x}{:04x}{tail}",
        guid.data1, guid.data2, guid.data3
    )
}

/// Quita la capa de compatibilidad RUNASADMIN de nuestro propio .exe si quedó
/// de una versión antigua que se elevaba: fuerza a correr elevado e impide que
/// Modo Objetivo ilumine la ventana. El efecto surte en el próximo arranque.
pub fn clear_own_runasadmin_layer() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe_w = to_wide(&exe.to_string_lossy());
    let subkey = to_wide(r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers");
    unsafe {
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            KEY_SET_VALUE,
            &mut hkey,
        )
        .is_ok()
        {
            let _ = RegDeleteValueW(hkey, PCWSTR(exe_w.as_ptr()));
            let _ = RegCloseKey(hkey);
        }
    }
}

pub enum SpawnErr {
    Cancelled,
    Other,
}

/// Relanza este mismo .exe como ayudante elevado (dispara UAC). Le pasa el PID
/// de la UI para que solo acepte a ese cliente. Devuelve el PID del ayudante.
pub fn spawn_helper_elevated(pipe: &str, parent_pid: u32) -> Result<u32, SpawnErr> {
    let exe = std::env::current_exe().map_err(|_| SpawnErr::Other)?;
    let exe_w = to_wide(&exe.to_string_lossy());
    let verb_w = to_wide("runas");
    let params_w = to_wide(&format!("--helper --pipe {pipe} --parent {parent_pid}"));
    unsafe {
        // ShellExecuteEx puede delegar en extensiones COM del shell; COM aún no
        // está inicializado a esta altura. STA es lo que WebView2 querrá luego.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let mut sei = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: PCWSTR(verb_w.as_ptr()),
            lpFile: PCWSTR(exe_w.as_ptr()),
            lpParameters: PCWSTR(params_w.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        match ShellExecuteExW(&mut sei) {
            Ok(()) => {
                let pid = GetProcessId(sei.hProcess);
                let _ = CloseHandle(sei.hProcess);
                Ok(pid)
            }
            // 1223 = el usuario canceló el UAC
            Err(e) if e.code().0 as u32 & 0xFFFF == 1223 => Err(SpawnErr::Cancelled),
            Err(_) => Err(SpawnErr::Other),
        }
    }
}

// ---------------------------------------------------------------------------
// Cliente (proceso UI, sin elevar)
// ---------------------------------------------------------------------------

pub struct PipeClient {
    conn: Mutex<BufReader<File>>,
}

/// El servidor del pipe debe ser el ayudante que lanzamos (no un impostor que
/// haya ocupado el nombre). GetNamedPipeServerProcessId lo reporta el kernel.
fn server_matches(f: &File, expected_pid: u32) -> bool {
    unsafe {
        let h = HANDLE(f.as_raw_handle());
        let mut pid = 0u32;
        GetNamedPipeServerProcessId(h, &mut pid).is_ok() && pid == expected_pid
    }
}

impl PipeClient {
    /// Conecta al pipe del ayudante, reintentando mientras arranca (~10 s), y
    /// verifica que el servidor sea el PID esperado (no un impostor).
    pub fn connect(pipe: &str, server_pid: u32) -> Option<PipeClient> {
        for _ in 0..100 {
            if let Ok(f) = OpenOptions::new().read(true).write(true).open(pipe) {
                return server_matches(&f, server_pid).then(|| PipeClient {
                    conn: Mutex::new(BufReader::new(f)),
                });
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        None
    }

    fn call(&self, req: &Req) -> Option<Resp> {
        let mut guard = self.conn.lock().ok()?;
        let mut line = serde_json::to_string(req).ok()?;
        line.push('\n');
        guard.get_mut().write_all(line.as_bytes()).ok()?;
        guard.get_mut().flush().ok()?;
        let mut resp = String::new();
        if guard.read_line(&mut resp).ok()? == 0 {
            return None;
        }
        serde_json::from_str(resp.trim_end()).ok()
    }

    pub fn snapshot(&self) -> Value {
        match self.call(&Req::Snapshot) {
            Some(Resp::Snapshot(v)) => v,
            _ => Value::Null,
        }
    }

    fn action(&self, req: Req) -> Result<(), String> {
        match self.call(&req) {
            Some(Resp::Action(r)) => r,
            _ => Err("sin respuesta del ayudante".into()),
        }
    }

    pub fn kill(&self, pid: u32) -> Result<(), String> {
        self.action(Req::Kill(pid))
    }
    pub fn kill_tree(&self, pid: u32) -> Result<(), String> {
        self.action(Req::KillTree(pid))
    }
    pub fn suspend(&self, pid: u32) -> Result<(), String> {
        self.action(Req::Suspend(pid))
    }
    pub fn resume(&self, pid: u32) -> Result<(), String> {
        self.action(Req::Resume(pid))
    }

    pub fn icon(&self, path: String) -> Option<String> {
        match self.call(&Req::Icon(path)) {
            Some(Resp::Icon(v)) => v,
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Servidor (proceso ayudante, elevado)
// ---------------------------------------------------------------------------

fn handle_req(req: Req, state: &MonitorState) -> Resp {
    match req {
        Req::Snapshot => {
            Resp::Snapshot(serde_json::to_value(state.snapshot()).unwrap_or(Value::Null))
        }
        Req::Kill(pid) => Resp::Action(control::kill_process(pid)),
        Req::KillTree(pid) => Resp::Action(control::kill_process_tree(pid)),
        Req::Suspend(pid) => Resp::Action(control::suspend_process(pid)),
        Req::Resume(pid) => Resp::Action(control::resume_process(pid)),
        Req::Icon(path) => Resp::Icon(icons::get_icon(path)),
    }
}

fn serve(file: File, state: &MonitorState) {
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break, // cliente cerró (UI cerrada)
            Ok(_) => {}
        }
        let Ok(req) = serde_json::from_str::<Req>(line.trim_end()) else {
            continue;
        };
        let resp = handle_req(req, state);
        let mut out = serde_json::to_string(&resp).unwrap_or_else(|_| "null".into());
        out.push('\n');
        if reader.get_mut().write_all(out.as_bytes()).is_err() {
            break;
        }
        let _ = reader.get_mut().flush();
    }
}

/// El cliente legítimo es el proceso UI, cuyo PID se pasó al lanzar el ayudante.
/// GetNamedPipeClientProcessId lo reporta el kernel; no es falsificable.
unsafe fn client_trusted(pipe: HANDLE, parent_pid: u32) -> bool {
    let mut pid = 0u32;
    if GetNamedPipeClientProcessId(pipe, &mut pid).is_err() {
        return false;
    }
    pid == parent_pid
}

/// Crea el pipe con DACL explícita (usuarios interactivos + SYSTEM) para que la
/// UI de integridad media pueda abrirlo, y FILE_FLAG_FIRST_PIPE_INSTANCE para
/// fallar si otro proceso ya ocupó el nombre (squatting).
fn create_pipe(name: &str) -> Option<HANDLE> {
    let name_w = to_wide(name);
    let sddl_w = to_wide("D:P(A;;GA;;;IU)(A;;GA;;;SY)");
    unsafe {
        let mut psd = PSECURITY_DESCRIPTOR::default();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl_w.as_ptr()),
            SDDL_REVISION_1,
            &mut psd,
            None,
        )
        .is_err()
        {
            return None;
        }
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: psd.0,
            bInheritHandle: false.into(),
        };
        let h = CreateNamedPipeW(
            PCWSTR(name_w.as_ptr()),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            64 * 1024,
            64 * 1024,
            0,
            Some(&sa),
        );
        let _ = LocalFree(Some(HLOCAL(psd.0)));
        if h == INVALID_HANDLE_VALUE {
            None
        } else {
            Some(h)
        }
    }
}

/// Sale del proceso si la UI (padre) muere, para no quedar como huérfano.
fn watch_parent(parent_pid: u32) {
    std::thread::spawn(move || unsafe {
        if let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, parent_pid) {
            WaitForSingleObject(h, INFINITE);
            let _ = CloseHandle(h);
        }
        std::process::exit(0);
    });
}

/// Bucle del ayudante: crea el pipe, atiende al cliente de confianza y termina
/// cuando la UI se cierra. No usa `process::exit` en el camino normal para que
/// se ejecuten los `Drop` (cierre limpio de la sesión ETW).
pub fn run_server(pipe: &str, parent_pid: u32) {
    watch_parent(parent_pid);
    let state = MonitorState::new();
    loop {
        // Si create falla (p. ej. nombre ya ocupado), no servimos: salir.
        let Some(handle) = create_pipe(pipe) else {
            return;
        };
        unsafe {
            // ERROR_PIPE_CONNECTED = el cliente ya se conectó en la ventana de
            // carrera; también cuenta como conexión válida.
            let connected = match ConnectNamedPipe(handle, None) {
                Ok(()) => true,
                Err(e) => e.code() == HRESULT::from_win32(ERROR_PIPE_CONNECTED.0),
            };
            if !connected {
                let _ = CloseHandle(handle);
                continue;
            }
            if client_trusted(handle, parent_pid) {
                let file = File::from_raw_handle(handle.0 as *mut c_void);
                serve(file, &state); // hasta que el cliente cierre
                return; // UI cerrada -> salir
            }
            // cliente no confiable: descartar y esperar al real
            let _ = DisconnectNamedPipe(handle);
            let _ = CloseHandle(handle);
        }
    }
}
