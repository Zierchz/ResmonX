// Battery via the battery device IOCTLs (poclass.h) + GetSystemPowerStatus.
use serde::Serialize;
use std::mem::size_of;
use windows::core::PCWSTR;
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_Device_Interface_ListW, CM_Get_Device_Interface_List_SizeW,
    CM_GET_DEVICE_INTERFACE_LIST_PRESENT, CR_SUCCESS,
};
use windows::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Power::{
    BatteryInformation, GetSystemPowerStatus, BATTERY_CHARGING, BATTERY_DISCHARGING,
    BATTERY_INFORMATION, BATTERY_QUERY_INFORMATION, BATTERY_STATUS, BATTERY_WAIT_STATUS,
    GUID_DEVICE_BATTERY, IOCTL_BATTERY_QUERY_INFORMATION, IOCTL_BATTERY_QUERY_STATUS,
    IOCTL_BATTERY_QUERY_TAG, SYSTEM_POWER_STATUS,
};
use windows::Win32::System::IO::DeviceIoControl;

#[derive(Serialize)]
pub struct BatterySnapshot {
    percent: f64,
    ac_online: bool,
    charging: bool,
    discharging: bool,
    saver: bool,
    // mW; >0 charging, <0 discharging
    rate_mw: i32,
    remaining_mwh: u32,
    full_mwh: u32,
    design_mwh: u32,
    voltage_mv: u32,
    chemistry: String,
    // Windows estimate, only meaningful on battery
    time_remaining_s: Option<u32>,
}

struct Device {
    handle: HANDLE,
    tag: u32,
    design_mwh: u32,
    full_mwh: u32,
    chemistry: String,
}

pub struct BatteryMonitor(Option<Device>);

// HANDLE is only used behind the MonitorState mutex
unsafe impl Send for BatteryMonitor {}

impl BatteryMonitor {
    pub fn new() -> Self {
        Self(unsafe { open_first_battery() })
    }

    pub fn snapshot(&self) -> Option<BatterySnapshot> {
        let d = self.0.as_ref()?;
        unsafe {
            let wait = BATTERY_WAIT_STATUS {
                BatteryTag: d.tag,
                ..Default::default()
            };
            let mut status = BATTERY_STATUS::default();
            if !ioctl(d.handle, IOCTL_BATTERY_QUERY_STATUS, &wait, &mut status) {
                return None;
            }

            let mut sys = SYSTEM_POWER_STATUS::default();
            let _ = GetSystemPowerStatus(&mut sys);

            let discharging = status.PowerState & BATTERY_DISCHARGING != 0;
            // BATTERY_UNKNOWN_RATE
            let rate_mw = if status.Rate == i32::MIN { 0 } else { status.Rate };
            Some(BatterySnapshot {
                percent: status.Capacity as f64 / d.full_mwh.max(1) as f64 * 100.0,
                ac_online: sys.ACLineStatus == 1,
                charging: status.PowerState & BATTERY_CHARGING != 0,
                discharging,
                saver: sys.SystemStatusFlag == 1,
                rate_mw,
                remaining_mwh: status.Capacity,
                full_mwh: d.full_mwh,
                design_mwh: d.design_mwh,
                voltage_mv: status.Voltage,
                chemistry: d.chemistry.clone(),
                time_remaining_s: (discharging && sys.BatteryLifeTime != u32::MAX)
                    .then_some(sys.BatteryLifeTime),
            })
        }
    }
}

impl Drop for BatteryMonitor {
    fn drop(&mut self) {
        if let Some(d) = &self.0 {
            unsafe {
                let _ = CloseHandle(d.handle);
            }
        }
    }
}

unsafe fn ioctl<I, O>(h: HANDLE, code: u32, input: &I, out: &mut O) -> bool {
    let mut ret = 0u32;
    DeviceIoControl(
        h,
        code,
        Some(input as *const _ as *const _),
        size_of::<I>() as u32,
        Some(out as *mut _ as *mut _),
        size_of::<O>() as u32,
        Some(&mut ret),
        None,
    )
    .is_ok()
}

// first present battery device; static info is read once
unsafe fn open_first_battery() -> Option<Device> {
    let mut len = 0u32;
    if CM_Get_Device_Interface_List_SizeW(
        &mut len,
        &GUID_DEVICE_BATTERY,
        PCWSTR::null(),
        CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
    ) != CR_SUCCESS
        || len <= 1
    {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    if CM_Get_Device_Interface_ListW(
        &GUID_DEVICE_BATTERY,
        PCWSTR::null(),
        &mut buf,
        CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
    ) != CR_SUCCESS
    {
        return None;
    }
    // multi-string; take the first path
    if buf.first() == Some(&0) {
        return None;
    }

    let handle = CreateFileW(
        PCWSTR(buf.as_ptr()),
        (GENERIC_READ | GENERIC_WRITE).0,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        None,
        OPEN_EXISTING,
        FILE_FLAGS_AND_ATTRIBUTES::default(),
        None,
    )
    .ok()?;

    // every query IOCTL needs the current tag
    let wait_ms = 0u32;
    let mut tag = 0u32;
    if !ioctl(handle, IOCTL_BATTERY_QUERY_TAG, &wait_ms, &mut tag) || tag == 0 {
        let _ = CloseHandle(handle);
        return None;
    }

    let query = BATTERY_QUERY_INFORMATION {
        BatteryTag: tag,
        InformationLevel: BatteryInformation,
        AtRate: 0,
    };
    let mut info = BATTERY_INFORMATION::default();
    if !ioctl(handle, IOCTL_BATTERY_QUERY_INFORMATION, &query, &mut info) {
        let _ = CloseHandle(handle);
        return None;
    }

    Some(Device {
        handle,
        tag,
        design_mwh: info.DesignedCapacity,
        full_mwh: info.FullChargedCapacity,
        chemistry: chemistry_name(&info.Chemistry),
    })
}

// poclass.h chemistry codes -> friendly name
fn chemistry_name(c: &[u8; 4]) -> String {
    let raw = String::from_utf8_lossy(c);
    let raw = raw.trim_end_matches(['\0', ' ']);
    match raw.to_ascii_uppercase().as_str() {
        "LION" | "LI-I" => "Li-ion".into(),
        "LIP" => "Li-poly".into(),
        "PBAC" => "Pb".into(),
        "NICD" => "NiCd".into(),
        "NIMH" => "NiMH".into(),
        "NIZN" => "NiZn".into(),
        _ => raw.to_string(),
    }
}
