mod cpufreq;
mod gpu;
mod net;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Networks, ProcessesToUpdate, System};

#[derive(Serialize)]
pub struct CpuSnapshot {
    name: String,
    usage: f32,
    per_core: Vec<f32>,
    freq_mhz: f64,
    base_mhz: u64,
    cores: usize,
}

#[derive(Serialize)]
pub struct MemorySnapshot {
    total: u64,
    used: u64,
    swap_total: u64,
    swap_used: u64,
}

#[derive(Serialize)]
pub struct ProcessSnapshot {
    pid: u32,
    name: String,
    cpu: f32,
    memory: u64,
    read_bps: u64,
    write_bps: u64,
}

#[derive(Serialize)]
pub struct NicSnapshot {
    name: String,
    rx_bps: u64,
    tx_bps: u64,
}

#[derive(Serialize)]
pub struct Snapshot {
    cpu: CpuSnapshot,
    memory: MemorySnapshot,
    processes: Vec<ProcessSnapshot>,
    nics: Vec<NicSnapshot>,
    connections: Vec<net::Connection>,
    gpu: Option<gpu::GpuSnapshot>,
}

pub struct MonitorState(Mutex<Inner>);

struct Inner {
    sys: System,
    networks: Networks,
    gpu: gpu::GpuMonitor,
    cpufreq: cpufreq::CpuFreq,
    last: Instant,
}

impl MonitorState {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_all();
        sys.refresh_memory();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        Self(Mutex::new(Inner {
            sys,
            networks: Networks::new_with_refreshed_list(),
            gpu: gpu::GpuMonitor::new(),
            cpufreq: cpufreq::CpuFreq::new(),
            last: Instant::now(),
        }))
    }
}

#[tauri::command]
pub fn get_snapshot(state: tauri::State<MonitorState>) -> Snapshot {
    let inner = &mut *state.0.lock().unwrap();
    let elapsed = inner.last.elapsed().as_secs_f64().max(0.2);
    inner.last = Instant::now();

    inner.sys.refresh_cpu_all();
    inner.sys.refresh_memory();
    inner.sys.refresh_processes(ProcessesToUpdate::All, true);
    inner.networks.refresh(true);

    let cores = inner.sys.cpus().len().max(1);
    let names: HashMap<u32, String> = inner
        .sys
        .processes()
        .iter()
        .map(|(pid, p)| (pid.as_u32(), p.name().to_string_lossy().into_owned()))
        .collect();

    let perf = inner.cpufreq.performance_percent().unwrap_or(100.0);
    let base_mhz = inner.sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);
    let cpu = CpuSnapshot {
        name: inner
            .sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_default(),
        usage: inner.sys.global_cpu_usage(),
        per_core: inner.sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        freq_mhz: base_mhz as f64 * perf / 100.0,
        base_mhz,
        cores,
    };

    let memory = MemorySnapshot {
        total: inner.sys.total_memory(),
        used: inner.sys.used_memory(),
        swap_total: inner.sys.total_swap(),
        swap_used: inner.sys.used_swap(),
    };

    let mut processes: Vec<ProcessSnapshot> = inner
        .sys
        .processes()
        .values()
        .map(|p| {
            let du = p.disk_usage();
            ProcessSnapshot {
                pid: p.pid().as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                cpu: p.cpu_usage() / cores as f32,
                memory: p.memory(),
                read_bps: (du.read_bytes as f64 / elapsed) as u64,
                write_bps: (du.written_bytes as f64 / elapsed) as u64,
            }
        })
        .collect();
    processes.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));

    let nics: Vec<NicSnapshot> = inner
        .networks
        .iter()
        .map(|(name, data)| NicSnapshot {
            name: name.clone(),
            rx_bps: (data.received() as f64 / elapsed) as u64,
            tx_bps: (data.transmitted() as f64 / elapsed) as u64,
        })
        .collect();

    Snapshot {
        cpu,
        memory,
        processes,
        nics,
        connections: net::collect(&names),
        gpu: inner.gpu.snapshot(&names),
    }
}
