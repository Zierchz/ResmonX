use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::enums::device::UsedGpuMemory;
use nvml_wrapper::Nvml;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct GpuProcess {
    pid: u32,
    name: String,
    vram: u64,
    kind: String,
}

#[derive(Serialize)]
pub struct GpuSnapshot {
    name: String,
    utilization: u32,
    mem_used: u64,
    mem_total: u64,
    temp: u32,
    power_w: f64,
    clock_core: u32,
    clock_core_max: u32,
    clock_mem: u32,
    clock_mem_max: u32,
    pstate: String,
    processes: Vec<GpuProcess>,
}

pub struct GpuMonitor(Option<Nvml>);

impl GpuMonitor {
    pub fn new() -> Self {
        Self(Nvml::init().ok())
    }

    pub fn snapshot(&self, names: &HashMap<u32, String>) -> Option<GpuSnapshot> {
        let nvml = self.0.as_ref()?;
        let device = nvml.device_by_index(0).ok()?;
        let mem = device.memory_info().ok()?;

        let mut processes = Vec::new();
        let mut push = |list: Vec<nvml_wrapper::struct_wrappers::device::ProcessInfo>, kind: &str| {
            for p in list {
                let vram = match p.used_gpu_memory {
                    UsedGpuMemory::Used(b) => b,
                    UsedGpuMemory::Unavailable => 0,
                };
                processes.push(GpuProcess {
                    pid: p.pid,
                    name: names.get(&p.pid).cloned().unwrap_or_else(|| "?".into()),
                    vram,
                    kind: kind.into(),
                });
            }
        };
        push(device.running_graphics_processes().unwrap_or_default(), "gráficos");
        push(device.running_compute_processes().unwrap_or_default(), "cómputo");

        Some(GpuSnapshot {
            name: device.name().ok()?,
            utilization: device.utilization_rates().ok().map(|u| u.gpu).unwrap_or(0),
            mem_used: mem.used,
            mem_total: mem.total,
            temp: device.temperature(TemperatureSensor::Gpu).unwrap_or(0),
            power_w: device.power_usage().unwrap_or(0) as f64 / 1000.0,
            clock_core: device.clock_info(Clock::Graphics).unwrap_or(0),
            clock_core_max: device.max_clock_info(Clock::Graphics).unwrap_or(0),
            clock_mem: device.clock_info(Clock::Memory).unwrap_or(0),
            clock_mem_max: device.max_clock_info(Clock::Memory).unwrap_or(0),
            pstate: device
                .performance_state()
                .map(|p| format!("{:?}", p))
                .unwrap_or_default(),
            processes,
        })
    }
}
