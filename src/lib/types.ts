// TS interfaces mirror the Rust #[derive(Serialize)] structs 1:1 (snake_case).
// Change one, change the other.

export interface CpuSnapshot {
  name: string;
  usage: number;
  per_core: number[];
  freq_mhz: number;
  base_mhz: number;
  cores: number;
}

export interface MemorySnapshot {
  total: number;
  used: number;
  swap_total: number;
  swap_used: number;
  commit: number;
  commit_limit: number;
  standby: number;
  modified: number;
  free: number;
  hard_faults_ps: number;
}

export interface ProcessSnapshot {
  pid: number;
  name: string;
  exe: string;
  cpu: number;
  memory: number;
  virtual_memory: number;
  threads: number;
  read_bps: number;
  write_bps: number;
}

export interface NicSnapshot {
  name: string;
  rx_bps: number;
  tx_bps: number;
}

export interface Connection {
  pid: number;
  process: string;
  protocol: string;
  local: string;
  remote: string;
  state: string;
}

export interface DiskSnapshot {
  name: string;
  mount: string;
  fs: string;
  total: number;
  available: number;
  removable: boolean;
  active_pct: number;
  queue: number;
}

export interface ServiceSnapshot {
  name: string;
  display: string;
  pid: number;
  state: string;
}

export interface NetProcSnapshot {
  pid: number;
  name: string;
  sent_bps: number;
  recv_bps: number;
}

export interface FileActivitySnapshot {
  pid: number;
  name: string;
  file: string;
  read_bps: number;
  write_bps: number;
}

export interface GpuProcess {
  pid: number;
  name: string;
  vram: number;
  kind: string;
}

export interface GpuSnapshot {
  name: string;
  utilization: number;
  mem_used: number;
  mem_total: number;
  temp: number;
  power_w: number;
  clock_core: number;
  clock_core_max: number;
  clock_mem: number;
  clock_mem_max: number;
  pstate: string;
  processes: GpuProcess[];
}

export interface Snapshot {
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  processes: ProcessSnapshot[];
  nics: NicSnapshot[];
  connections: Connection[];
  disks: DiskSnapshot[];
  services: ServiceSnapshot[];
  gpu: GpuSnapshot | null;
  etw: boolean;
  net_procs: NetProcSnapshot[];
  file_activity: FileActivitySnapshot[];
}

// rolling history for sparklines
export interface History {
  cpu: number[];
  mem: number[];
  rx: number[];
  tx: number[];
  gpu: number[];
  read: number[];
  write: number[];
}

// process target for the row context menu
export interface CtxTarget {
  pid: number;
  name: string;
  exe: string;
}
