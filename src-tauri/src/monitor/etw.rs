use ferrisetw::parser::{Parser, Pointer};
use ferrisetw::provider::Provider;
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::UserTrace;
use ferrisetw::EventRecord;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::QueryDosDeviceW;
use windows::Win32::System::Diagnostics::Etw::{
    ControlTraceW, CONTROLTRACE_HANDLE, EVENT_TRACE_CONTROL_STOP, EVENT_TRACE_PROPERTIES,
};

const SESSION_NAME: &str = "ResmonX-Trace";
// Microsoft-Windows-Kernel-Network
const KERNEL_NETWORK: &str = "7DD42A49-5329-4832-8DFD-43D979153A88";
// Microsoft-Windows-Kernel-File
const KERNEL_FILE: &str = "EDD08927-9CC4-4E65-B970-C2560FB5C289";
// keywords Kernel-File: FILEIO | CREATE | READ | WRITE | CREATE_NEW_FILE
const KERNEL_FILE_KEYWORDS: u64 = 0x20 | 0x80 | 0x100 | 0x200 | 0x1000;

// límites para acotar memoria bajo carga
const MAX_AGG_ENTRIES: usize = 8192;
const MAX_FILE_NAMES: usize = 16384;

#[derive(Default)]
struct NetAgg {
    sent: u64,
    recv: u64,
}

#[derive(Default)]
struct IoAgg {
    read: u64,
    write: u64,
}

#[derive(Default)]
struct Shared {
    // pid -> bytes acumulados desde el último drain
    net: Mutex<HashMap<u32, NetAgg>>,
    // (pid, FileObject) -> bytes acumulados
    file_io: Mutex<HashMap<(u32, usize), IoAgg>>,
    // FileObject -> ruta (poblado por eventos Create)
    file_names: Mutex<HashMap<usize, String>>,
}

pub struct NetActivity {
    pub pid: u32,
    pub sent: u64,
    pub recv: u64,
}

pub struct FileActivity {
    pub pid: u32,
    pub file: String,
    pub read: u64,
    pub write: u64,
}

pub struct EtwMonitor {
    shared: Arc<Shared>,
    // mantiene viva la sesión; su Drop la detiene al cerrar la app
    trace: Option<UserTrace>,
    // "\Device\HarddiskVolume3" -> "C:"
    drives: Vec<(String, String)>,
}

/// Detiene una sesión previa con el mismo nombre (queda huérfana si la app
/// murió sin limpiar). Si no existe, falla en silencio.
fn stop_orphan_session() {
    let wide: Vec<u16> = SESSION_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    let size = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() + 2 * 1024;
    let mut buf = vec![0u8; size];
    unsafe {
        let props = buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES;
        (*props).Wnode.BufferSize = size as u32;
        (*props).LoggerNameOffset = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() as u32;
        let _ = ControlTraceW(
            CONTROLTRACE_HANDLE::default(),
            PCWSTR(wide.as_ptr()),
            props,
            EVENT_TRACE_CONTROL_STOP,
        );
    }
}

fn drive_map() -> Vec<(String, String)> {
    let mut map = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:", letter as char);
        let wide: Vec<u16> = drive.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = [0u16; 512];
        let n = unsafe { QueryDosDeviceW(PCWSTR(wide.as_ptr()), Some(&mut buf)) };
        if n > 0 {
            let end = buf.iter().position(|&c| c == 0).unwrap_or(0);
            if end > 0 {
                map.push((String::from_utf16_lossy(&buf[..end]), drive));
            }
        }
    }
    // prefijos más largos primero para reemplazar correctamente
    map.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    map
}

// IDs Kernel-Network: TCP tx/rx v4 (10/11), v6 (26/27); UDP v4 (42/43), v6 (58/59)
fn net_callback(record: &EventRecord, schema_locator: &SchemaLocator, shared: &Shared) {
    let sent = match record.event_id() {
        10 | 26 | 42 | 58 => true,
        11 | 27 | 43 | 59 => false,
        _ => return,
    };
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    // el PID va en el payload; el de la cabecera no es el del proceso real
    let Ok(pid) = parser.try_parse::<u32>("PID") else {
        return;
    };
    let Ok(size) = parser.try_parse::<u32>("size") else {
        return;
    };
    let Ok(mut net) = shared.net.lock() else {
        return;
    };
    if net.len() >= MAX_AGG_ENTRIES && !net.contains_key(&pid) {
        return;
    }
    let entry = net.entry(pid).or_default();
    if sent {
        entry.sent += size as u64;
    } else {
        entry.recv += size as u64;
    }
}

// IDs Kernel-File: Create (12), Close (14), Read (15), Write (16), CreateNewFile (30)
fn file_callback(record: &EventRecord, schema_locator: &SchemaLocator, shared: &Shared) {
    let id = record.event_id();
    if !matches!(id, 12 | 14 | 15 | 16 | 30) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let Ok(fo) = parser.try_parse::<Pointer>("FileObject") else {
        return;
    };
    let fo = *fo;
    match id {
        12 | 30 => {
            let Ok(name) = parser.try_parse::<String>("FileName") else {
                return;
            };
            let Ok(mut names) = shared.file_names.lock() else {
                return;
            };
            // autolimpieza si el mapa crece demasiado (nombres viejos se pierden)
            if names.len() >= MAX_FILE_NAMES {
                names.clear();
            }
            names.insert(fo, name);
        }
        14 => {
            if let Ok(mut names) = shared.file_names.lock() {
                names.remove(&fo);
            }
        }
        15 | 16 => {
            let Ok(size) = parser.try_parse::<u32>("IOSize") else {
                return;
            };
            let pid = record.process_id();
            let Ok(mut io) = shared.file_io.lock() else {
                return;
            };
            let key = (pid, fo);
            if io.len() >= MAX_AGG_ENTRIES && !io.contains_key(&key) {
                return;
            }
            let entry = io.entry(key).or_default();
            if id == 15 {
                entry.read += size as u64;
            } else {
                entry.write += size as u64;
            }
        }
        _ => {}
    }
}

impl EtwMonitor {
    /// Si la app no corre elevada, el arranque de la sesión falla y el
    /// monitor queda deshabilitado (`available() == false`); el resto de la
    /// app no se ve afectado.
    pub fn new() -> Self {
        stop_orphan_session();
        let shared = Arc::new(Shared::default());

        let net_shared = shared.clone();
        let net_provider = Provider::by_guid(KERNEL_NETWORK)
            .add_callback(move |r: &EventRecord, l: &SchemaLocator| {
                net_callback(r, l, &net_shared)
            })
            .build();

        let file_shared = shared.clone();
        let file_provider = Provider::by_guid(KERNEL_FILE)
            .any(KERNEL_FILE_KEYWORDS)
            .add_callback(move |r: &EventRecord, l: &SchemaLocator| {
                file_callback(r, l, &file_shared)
            })
            .build();

        let trace = UserTrace::new()
            .named(SESSION_NAME.to_string())
            .enable(net_provider)
            .enable(file_provider)
            .start_and_process()
            .ok();

        Self {
            shared,
            trace,
            drives: drive_map(),
        }
    }

    pub fn available(&self) -> bool {
        self.trace.is_some()
    }

    fn to_dos_path(&self, nt: &str) -> String {
        for (device, drive) in &self.drives {
            if nt.starts_with(device.as_str()) {
                return format!("{}{}", drive, &nt[device.len()..]);
            }
        }
        nt.to_string()
    }

    /// Vacía los acumuladores y devuelve la actividad desde el último drain.
    pub fn drain(&self) -> (Vec<NetActivity>, Vec<FileActivity>) {
        let net_map = self
            .shared
            .net
            .lock()
            .map(|mut m| std::mem::take(&mut *m))
            .unwrap_or_default();
        let io_map = self
            .shared
            .file_io
            .lock()
            .map(|mut m| std::mem::take(&mut *m))
            .unwrap_or_default();

        let net = net_map
            .into_iter()
            .map(|(pid, a)| NetActivity {
                pid,
                sent: a.sent,
                recv: a.recv,
            })
            .collect();

        let names = self.shared.file_names.lock();
        let files = io_map
            .into_iter()
            .map(|((pid, fo), a)| {
                let file = names
                    .as_ref()
                    .ok()
                    .and_then(|n| n.get(&fo).cloned())
                    .map(|n| self.to_dos_path(&n))
                    .unwrap_or_else(|| "—".into());
                FileActivity {
                    pid,
                    file,
                    read: a.read,
                    write: a.write,
                }
            })
            .collect();

        (net, files)
    }
}
