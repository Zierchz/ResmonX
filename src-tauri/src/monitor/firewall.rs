// Block rules on the Windows Filtering Platform from user mode — no kernel
// driver, the same mechanism simplewall uses. Rate limiting is deliberately out
// of scope: throttling needs a callout driver in the kernel.
//
// The engine session is DYNAMIC, so Windows removes every filter we added when
// this process exits: no rule can outlive ResmonX and leave someone offline.
use crate::monitor::control;
use serde::Serialize;
use std::ffi::c_void;
use std::net::IpAddr;
use std::sync::Mutex;
use windows::core::{GUID, PCWSTR, PWSTR};
use windows::Win32::Foundation::{FWP_E_ALREADY_EXISTS, HANDLE};
use windows::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmEngineClose0, FwpmEngineOpen0, FwpmFilterAdd0, FwpmFilterDeleteById0, FwpmFreeMemory0,
    FwpmGetAppIdFromFileName0, FwpmSubLayerAdd0, FWPM_CONDITION_ALE_APP_ID,
    FWPM_CONDITION_IP_REMOTE_ADDRESS, FWPM_FILTER0, FWPM_FILTER_CONDITION0,
    FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4, FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6, FWPM_SESSION0,
    FWPM_SESSION_FLAG_DYNAMIC, FWPM_SUBLAYER0, FWP_ACTION_BLOCK, FWP_BYTE_ARRAY16,
    FWP_BYTE_ARRAY16_TYPE, FWP_BYTE_BLOB, FWP_BYTE_BLOB_TYPE, FWP_CONDITION_VALUE0,
    FWP_CONDITION_VALUE0_0, FWP_MATCH_EQUAL, FWP_UINT32,
};
use windows::Win32::System::Rpc::RPC_C_AUTHN_DEFAULT;

// Our own sublayer: a BLOCK here holds regardless of what other firewalls
// permit in theirs. Max weight so nothing in our sublayer outranks it.
const SUBLAYER: GUID = GUID::from_u128(0x7b3f9c21_5d4e_4a8b_9c17_2e6f8d0a4b31);
const SUBLAYER_WEIGHT: u16 = 0xFFFF;

const KIND_PROCESS: &str = "process";
const KIND_IP: &str = "ip";

// An app rule covers both directions and both IP versions; an address rule only
// the layers of its own family.
const APP_LAYERS: [GUID; 4] = [
    FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
];
const V4_LAYERS: [GUID; 2] = [
    FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
];
const V6_LAYERS: [GUID; 2] = [
    FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
];

#[derive(Clone, Serialize)]
pub struct Rule {
    id: u64,
    kind: &'static str,
    /// exe path or remote IP — what the filters actually match
    target: String,
    /// what the UI shows (process name, or the IP again)
    label: String,
    #[serde(skip)]
    filters: Vec<u64>,
}

struct Fw {
    /// HANDLE isn't Send, so keep the raw value and rebuild it per call.
    engine: usize,
    rules: Vec<Rule>,
    next_id: u64,
}

static FW: Mutex<Option<Fw>> = Mutex::new(None);

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Opens a dynamic session (auto-cleanup on exit) and registers our sublayer.
fn open() -> Result<usize, String> {
    let mut name = to_wide("ResmonX");
    let mut session = FWPM_SESSION0 {
        flags: FWPM_SESSION_FLAG_DYNAMIC,
        ..Default::default()
    };
    session.displayData.name = PWSTR(name.as_mut_ptr());
    let mut engine = HANDLE::default();
    let rc = unsafe {
        FwpmEngineOpen0(
            PCWSTR::null(),
            RPC_C_AUTHN_DEFAULT as u32,
            None,
            Some(&session),
            &mut engine,
        )
    };
    if rc != 0 {
        return Err(format!(
            "no se pudo abrir el motor de filtrado de Windows (0x{rc:08x}); requiere permisos de administrador"
        ));
    }
    let mut sub = FWPM_SUBLAYER0 {
        subLayerKey: SUBLAYER,
        weight: SUBLAYER_WEIGHT,
        ..Default::default()
    };
    sub.displayData.name = PWSTR(name.as_mut_ptr());
    let rc = unsafe { FwpmSubLayerAdd0(engine, &sub, None) };
    if rc != 0 && rc != FWP_E_ALREADY_EXISTS.0 as u32 {
        unsafe { FwpmEngineClose0(engine) };
        return Err(format!(
            "no se pudo registrar el subnivel de filtrado (0x{rc:08x})"
        ));
    }
    Ok(engine.0 as usize)
}

fn engine_of(fw: &Fw) -> HANDLE {
    HANDLE(fw.engine as *mut c_void)
}

/// Brings the session up on the first rule.
fn session(slot: &mut Option<Fw>) -> Result<&mut Fw, String> {
    if slot.is_none() {
        *slot = Some(Fw {
            engine: open()?,
            rules: Vec::new(),
            next_id: 1,
        });
    }
    Ok(slot.as_mut().expect("session just opened"))
}

/// One BLOCK filter in our sublayer at `layer`, matching `cond`.
fn add_filter(
    engine: HANDLE,
    layer: GUID,
    cond: &FWPM_FILTER_CONDITION0,
    name: &mut [u16],
) -> Result<u64, String> {
    let mut filter = FWPM_FILTER0 {
        layerKey: layer,
        subLayerKey: SUBLAYER,
        numFilterConditions: 1,
        filterCondition: cond as *const _ as *mut _,
        ..Default::default()
    };
    filter.displayData.name = PWSTR(name.as_mut_ptr());
    filter.action.r#type = FWP_ACTION_BLOCK;
    let mut id = 0u64;
    let rc = unsafe { FwpmFilterAdd0(engine, &filter, None, Some(&mut id)) };
    if rc != 0 {
        return Err(format!(
            "no se pudo añadir el filtro de bloqueo (0x{rc:08x})"
        ));
    }
    Ok(id)
}

/// Applies the same condition to several layers, rolling back on failure so a
/// half-applied rule can't leave stray filters behind.
fn add_filters(
    engine: HANDLE,
    layers: &[GUID],
    cond: &FWPM_FILTER_CONDITION0,
    label: &str,
) -> Result<Vec<u64>, String> {
    let mut name = to_wide(&format!("ResmonX: {label}"));
    let mut ids: Vec<u64> = Vec::with_capacity(layers.len());
    for &layer in layers {
        match add_filter(engine, layer, cond, &mut name) {
            Ok(id) => ids.push(id),
            Err(e) => {
                for id in ids {
                    unsafe { FwpmFilterDeleteById0(engine, id) };
                }
                return Err(e);
            }
        }
    }
    Ok(ids)
}

/// WFP app id (the kernel-path form of an .exe), freed on drop.
struct AppId(*mut FWP_BYTE_BLOB);

impl AppId {
    fn new(exe: &str) -> Result<AppId, String> {
        let path = to_wide(exe);
        let mut blob = std::ptr::null_mut();
        let rc = unsafe { FwpmGetAppIdFromFileName0(PCWSTR(path.as_ptr()), &mut blob) };
        if rc != 0 || blob.is_null() {
            return Err(format!(
                "no se pudo resolver la ruta del ejecutable (0x{rc:08x})"
            ));
        }
        Ok(AppId(blob))
    }
}

impl Drop for AppId {
    fn drop(&mut self) {
        let mut p = self.0.cast::<c_void>();
        unsafe { FwpmFreeMemory0(&mut p) };
    }
}

/// Blocks an executable's network traffic — every instance of that path, present
/// and future, since WFP matches on the image and not on a PID. Also drops the
/// clicked process's live TCP connections: the filter is only consulted when a
/// connection is established, so already-open ones would survive it.
pub fn block_process(pid: u32, exe: &str, label: &str) -> Result<(), String> {
    if exe.is_empty() {
        return Err("no se conoce la ruta del ejecutable".into());
    }
    let mut guard = FW.lock().unwrap();
    {
        let fw = session(&mut guard)?;
        if fw
            .rules
            .iter()
            .any(|r| r.kind == KIND_PROCESS && r.target.eq_ignore_ascii_case(exe))
        {
            return Err("ese ejecutable ya está bloqueado".into());
        }
        let engine = engine_of(fw);
        let app = AppId::new(exe)?;
        let cond = FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_ALE_APP_ID,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: FWP_BYTE_BLOB_TYPE,
                Anonymous: FWP_CONDITION_VALUE0_0 { byteBlob: app.0 },
            },
        };
        let filters = add_filters(engine, &APP_LAYERS, &cond, label)?;
        fw.rules.push(Rule {
            id: fw.next_id,
            kind: KIND_PROCESS,
            target: exe.to_string(),
            label: label.to_string(),
            filters,
        });
        fw.next_id += 1;
    }
    drop(guard);
    control::close_process_connections(pid);
    Ok(())
}

/// Blocks all traffic to and from a remote address, machine-wide, and drops the
/// live TCP connections to it.
pub fn block_ip(ip: &str) -> Result<(), String> {
    let parsed: IpAddr = ip
        .parse()
        .map_err(|_| format!("dirección IP no válida: {ip}"))?;
    let mut guard = FW.lock().unwrap();
    {
        let fw = session(&mut guard)?;
        if fw.rules.iter().any(|r| r.kind == KIND_IP && r.target == ip) {
            return Err("esa dirección ya está bloqueada".into());
        }
        let engine = engine_of(fw);
        // exact address: uint32 in host order for v4, the 16 raw bytes for v6
        let mut v6 = FWP_BYTE_ARRAY16::default();
        let (value, layers): (FWP_CONDITION_VALUE0, &[GUID]) = match parsed {
            IpAddr::V4(a) => (
                FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT32,
                    Anonymous: FWP_CONDITION_VALUE0_0 {
                        uint32: u32::from(a),
                    },
                },
                &V4_LAYERS,
            ),
            IpAddr::V6(a) => {
                v6.byteArray16 = a.octets();
                (
                    FWP_CONDITION_VALUE0 {
                        r#type: FWP_BYTE_ARRAY16_TYPE,
                        Anonymous: FWP_CONDITION_VALUE0_0 {
                            byteArray16: &mut v6,
                        },
                    },
                    &V6_LAYERS,
                )
            }
        };
        let cond = FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_IP_REMOTE_ADDRESS,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: value,
        };
        let filters = add_filters(engine, layers, &cond, ip)?;
        fw.rules.push(Rule {
            id: fw.next_id,
            kind: KIND_IP,
            target: ip.to_string(),
            label: ip.to_string(),
            filters,
        });
        fw.next_id += 1;
    }
    drop(guard);
    control::close_remote_connections(ip);
    Ok(())
}

/// Drops a rule and its filters.
pub fn unblock(id: u64) -> Result<(), String> {
    let mut guard = FW.lock().unwrap();
    let Some(fw) = guard.as_mut() else {
        return Err("no hay reglas activas".into());
    };
    let Some(i) = fw.rules.iter().position(|r| r.id == id) else {
        return Err("la regla ya no existe".into());
    };
    let engine = engine_of(fw);
    let rule = fw.rules.remove(i);
    for fid in rule.filters {
        unsafe { FwpmFilterDeleteById0(engine, fid) };
    }
    Ok(())
}

/// Active rules, for the snapshot.
pub fn rules() -> Vec<Rule> {
    FW.lock()
        .ok()
        .and_then(|g| g.as_ref().map(|fw| fw.rules.clone()))
        .unwrap_or_default()
}
