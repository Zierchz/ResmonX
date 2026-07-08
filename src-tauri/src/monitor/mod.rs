mod cpufreq;
mod etw;
mod gpu;
mod net;
mod pdh;
mod services;
mod threads;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};

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
    commit: u64,
    commit_limit: u64,
    standby: u64,
    modified: u64,
    free: u64,
    hard_faults_ps: f64,
}

#[derive(Serialize)]
pub struct ProcessSnapshot {
    pid: u32,
    name: String,
    cpu: f32,
    memory: u64,
    virtual_memory: u64,
    threads: u32,
    read_bps: u64,
    write_bps: u64,
}

#[derive(Serialize)]
pub struct NetProcSnapshot {
    pid: u32,
    name: String,
    sent_bps: u64,
    recv_bps: u64,
}

#[derive(Serialize)]
pub struct FileActivitySnapshot {
    pid: u32,
    name: String,
    file: String,
    read_bps: u64,
    write_bps: u64,
}

#[derive(Serialize)]
pub struct DiskSnapshot {
    name: String,
    mount: String,
    fs: String,
    total: u64,
    available: u64,
    removable: bool,
    active_pct: f64,
    queue: f64,
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
    disks: Vec<DiskSnapshot>,
    services: Vec<services::ServiceSnapshot>,
    gpu: Option<gpu::GpuSnapshot>,
    etw: bool,
    net_procs: Vec<NetProcSnapshot>,
    file_activity: Vec<FileActivitySnapshot>,
}

pub struct MonitorState(Mutex<Inner>);

struct Inner {
    sys: System,
    networks: Networks,
    disks: Disks,
    gpu: gpu::GpuMonitor,
    cpufreq: cpufreq::CpuFreq,
    counters: pdh::SysCounters,
    etw: etw::EtwMonitor,
    last: Instant,
}

/// "C:\" -> "C:" (instancia PDH de LogicalDisk).
fn disk_instance(mount: &str) -> String {
    mount.trim_end_matches('\\').to_string()
}

impl MonitorState {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_all();
        sys.refresh_memory();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let disks = Disks::new_with_refreshed_list();
        let instances: Vec<String> = disks
            .list()
            .iter()
            .map(|d| disk_instance(&d.mount_point().to_string_lossy()))
            .collect();
        Self(Mutex::new(Inner {
            sys,
            networks: Networks::new_with_refreshed_list(),
            disks,
            gpu: gpu::GpuMonitor::new(),
            cpufreq: cpufreq::CpuFreq::new(),
            counters: pdh::SysCounters::new(&instances),
            etw: etw::EtwMonitor::new(),
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
    inner.disks.refresh(true);
    inner.counters.collect();
    let thread_map = threads::thread_counts();

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

    let mem = inner.counters.memory();
    let memory = MemorySnapshot {
        total: inner.sys.total_memory(),
        used: inner.sys.used_memory(),
        swap_total: inner.sys.total_swap(),
        swap_used: inner.sys.used_swap(),
        commit: mem.committed,
        commit_limit: mem.commit_limit,
        standby: mem.standby,
        modified: mem.modified,
        free: mem.free_zero,
        hard_faults_ps: mem.hard_faults_ps,
    };

    let mut processes: Vec<ProcessSnapshot> = inner
        .sys
        .processes()
        .values()
        .map(|p| {
            let du = p.disk_usage();
            let pid = p.pid().as_u32();
            ProcessSnapshot {
                pid,
                name: p.name().to_string_lossy().into_owned(),
                cpu: p.cpu_usage() / cores as f32,
                memory: p.memory(),
                virtual_memory: p.virtual_memory(),
                threads: thread_map.get(&pid).copied().unwrap_or(0),
                read_bps: (du.read_bytes as f64 / elapsed) as u64,
                write_bps: (du.written_bytes as f64 / elapsed) as u64,
            }
        })
        .collect();
    processes.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));

    let disks: Vec<DiskSnapshot> = inner
        .disks
        .list()
        .iter()
        .map(|d| {
            let mount = d.mount_point().to_string_lossy().into_owned();
            let (active_pct, queue) = inner.counters.disk(&disk_instance(&mount));
            DiskSnapshot {
                name: d.name().to_string_lossy().into_owned(),
                mount,
                fs: d.file_system().to_string_lossy().into_owned(),
                total: d.total_space(),
                available: d.available_space(),
                removable: d.is_removable(),
                active_pct,
                queue,
            }
        })
        .collect();

    let nics: Vec<NicSnapshot> = inner
        .networks
        .iter()
        .map(|(name, data)| NicSnapshot {
            name: name.clone(),
            rx_bps: (data.received() as f64 / elapsed) as u64,
            tx_bps: (data.transmitted() as f64 / elapsed) as u64,
        })
        .collect();

    let (etw_net, etw_files) = inner.etw.drain();
    let mut net_procs: Vec<NetProcSnapshot> = etw_net
        .into_iter()
        .map(|a| NetProcSnapshot {
            pid: a.pid,
            name: names.get(&a.pid).cloned().unwrap_or_else(|| "?".into()),
            sent_bps: (a.sent as f64 / elapsed) as u64,
            recv_bps: (a.recv as f64 / elapsed) as u64,
        })
        .collect();
    net_procs.sort_by_key(|p| std::cmp::Reverse(p.sent_bps + p.recv_bps));
    net_procs.truncate(100);

    let mut file_activity: Vec<FileActivitySnapshot> = etw_files
        .into_iter()
        .map(|a| FileActivitySnapshot {
            pid: a.pid,
            name: names.get(&a.pid).cloned().unwrap_or_else(|| "?".into()),
            file: a.file,
            read_bps: (a.read as f64 / elapsed) as u64,
            write_bps: (a.write as f64 / elapsed) as u64,
        })
        .collect();
    file_activity.sort_by_key(|f| std::cmp::Reverse(f.read_bps + f.write_bps));
    file_activity.truncate(100);

    Snapshot {
        cpu,
        memory,
        processes,
        nics,
        connections: net::collect(&names),
        disks,
        services: services::collect(),
        gpu: inner.gpu.snapshot(&names),
        etw: inner.etw.available(),
        net_procs,
        file_activity,
    }
}
