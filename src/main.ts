import { invoke } from "@tauri-apps/api/core";

interface CpuSnapshot {
  name: string;
  usage: number;
  per_core: number[];
  freq_mhz: number;
  base_mhz: number;
  cores: number;
}

interface MemorySnapshot {
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

interface ProcessSnapshot {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  virtual_memory: number;
  threads: number;
  read_bps: number;
  write_bps: number;
}

interface NicSnapshot {
  name: string;
  rx_bps: number;
  tx_bps: number;
}

interface Connection {
  pid: number;
  process: string;
  protocol: string;
  local: string;
  remote: string;
  state: string;
}

interface DiskSnapshot {
  name: string;
  mount: string;
  fs: string;
  total: number;
  available: number;
  removable: boolean;
  active_pct: number;
  queue: number;
}

interface ServiceSnapshot {
  name: string;
  display: string;
  pid: number;
  state: string;
}

interface NetProcSnapshot {
  pid: number;
  name: string;
  sent_bps: number;
  recv_bps: number;
}

interface FileActivitySnapshot {
  pid: number;
  name: string;
  file: string;
  read_bps: number;
  write_bps: number;
}

interface GpuProcess {
  pid: number;
  name: string;
  vram: number;
  kind: string;
}

interface GpuSnapshot {
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

interface Snapshot {
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

const HISTORY_LEN = 120;
const POLL_MS = 1500;

const history = {
  cpu: [] as number[],
  mem: [] as number[],
  rx: [] as number[],
  tx: [] as number[],
  gpu: [] as number[],
  read: [] as number[],
  write: [] as number[],
  faults: [] as number[],
};

let activeTab = "overview";
let procSortKey: keyof ProcessSnapshot = "cpu";
let procSortAsc = false;
let lastSnapshot: Snapshot | null = null;

function push(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > HISTORY_LEN) arr.shift();
}

function fmtBytes(b: number, suffix = ""): string {
  if (b < 1024) return `${b.toFixed(0)} B${suffix}`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}${suffix}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sparkline(values: number[], max: number, color: string): string {
  const w = 260;
  const h = 60;
  if (values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
  const step = w / (HISTORY_LEN - 1);
  const x0 = w - (values.length - 1) * step;
  const pts = values.map(
    (v, i) => `${(x0 + i * step).toFixed(1)},${(h - (Math.min(v, max) / max) * h).toFixed(1)}`,
  );
  const firstX = pts[0].split(",")[0];
  const lastX = pts[pts.length - 1].split(",")[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="${firstX},${h} ${pts.join(" ")} ${lastX},${h}" fill="${color}22"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

function card(title: string, value: string, detail: string, spark: string): string {
  return `<div class="card">
    <div class="card-title">${title}</div>
    <div class="card-value">${value}</div>
    <div class="card-detail">${detail}</div>
    ${spark}
  </div>`;
}

function usageBar(pct: number, color: string): string {
  const p = Math.max(0, Math.min(100, pct));
  return `<span class="usage-bar"><span class="usage-fill" style="width:${p.toFixed(0)}%;background:${color}"></span></span>${p.toFixed(0)}%`;
}

function renderTopbar(s: Snapshot) {
  document.getElementById("top-cpu")!.textContent = `CPU ${s.cpu.usage.toFixed(0)}%`;
  document.getElementById("top-freq")!.textContent = `${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz`;
  const memPct = (s.memory.used / s.memory.total) * 100;
  document.getElementById("top-mem")!.textContent = `RAM ${memPct.toFixed(0)}%`;
  document.getElementById("top-gpu")!.textContent = s.gpu ? `GPU ${s.gpu.utilization}%` : "GPU n/d";
}

function renderOverview(s: Snapshot) {
  const rx = s.nics.reduce((a, n) => a + n.rx_bps, 0);
  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  const read = s.processes.reduce((a, p) => a + p.read_bps, 0);
  const write = s.processes.reduce((a, p) => a + p.write_bps, 0);

  const cards = [
    card(
      "CPU",
      `${s.cpu.usage.toFixed(1)}%`,
      `${esc(s.cpu.name)} · ${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz efectivos · ${s.cpu.cores} núcleos`,
      sparkline(history.cpu, 100, "#4fc3f7"),
    ),
    card(
      "Memoria",
      `${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`,
      `${((s.memory.used / s.memory.total) * 100).toFixed(1)}% · swap ${fmtBytes(s.memory.swap_used)}`,
      sparkline(history.mem, 100, "#ba68c8"),
    ),
    card(
      "Red",
      `↓ ${fmtBytes(rx, "/s")} · ↑ ${fmtBytes(tx, "/s")}`,
      `${s.connections.length} conexiones activas`,
      sparkline(history.rx, Math.max(...history.rx, 1024 * 128), "#81c784"),
    ),
    card(
      "Disco",
      `R ${fmtBytes(read, "/s")} · W ${fmtBytes(write, "/s")}`,
      "I/O agregado por procesos",
      sparkline(history.write, Math.max(...history.write, 1024 * 512), "#ffb74d"),
    ),
  ];
  if (s.gpu) {
    cards.push(
      card(
        "GPU",
        `${s.gpu.utilization}% · ${s.gpu.clock_core} MHz`,
        `${esc(s.gpu.name)} · ${fmtBytes(s.gpu.mem_used)} VRAM · ${s.gpu.temp}°C · ${s.gpu.power_w.toFixed(1)} W · ${esc(s.gpu.pstate)}`,
        sparkline(history.gpu, 100, "#e57373"),
      ),
    );
  }
  document.getElementById("overview-cards")!.innerHTML = cards.join("");
}

function renderCpu(s: Snapshot) {
  const totalThreads = s.processes.reduce((a, p) => a + p.threads, 0);
  document.getElementById("cpu-cards")!.innerHTML =
    card(
      "Uso global",
      `${s.cpu.usage.toFixed(1)}%`,
      esc(s.cpu.name),
      sparkline(history.cpu, 100, "#4fc3f7"),
    ) +
    card(
      "Frecuencia efectiva",
      `${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz`,
      `base ${(s.cpu.base_mhz / 1000).toFixed(2)} GHz`,
      "",
    ) +
    card("Procesos", `${s.processes.length}`, `${totalThreads} hilos · ${s.cpu.cores} núcleos lógicos`, "");

  document.getElementById("core-grid")!.innerHTML = s.cpu.per_core
    .map(
      (u, i) => `<div class="core-cell">
        <div class="core-label"><span>N${i}</span><span>${u.toFixed(0)}%</span></div>
        <div class="core-track"><div class="core-fill" style="width:${Math.min(u, 100).toFixed(0)}%"></div></div>
      </div>`,
    )
    .join("");

  const rows = s.processes
    .slice(0, 15)
    .map(
      (p) => `<tr>
        <td>${esc(p.name)}</td>
        <td class="num">${p.pid}</td>
        <td class="num">${p.threads}</td>
        <td class="num">${p.cpu.toFixed(1)}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#cpu-proc-table tbody")!.innerHTML = rows;

  const cpuByPid = new Map(s.processes.map((p) => [p.pid, p.cpu]));
  const filter = (document.getElementById("svc-filter") as HTMLInputElement).value.toLowerCase();
  let services = s.services;
  if (filter) {
    services = services.filter(
      (v) =>
        v.name.toLowerCase().includes(filter) ||
        v.display.toLowerCase().includes(filter) ||
        String(v.pid) === filter,
    );
  }
  const svcRows = [...services]
    .sort((a, b) => {
      const ra = a.state === "En ejecución" ? 0 : 1;
      const rb = b.state === "En ejecución" ? 0 : 1;
      return ra - rb || a.name.localeCompare(b.name);
    })
    .map(
      (v) => `<tr>
        <td>${esc(v.name)}</td>
        <td>${esc(v.display)}</td>
        <td class="num">${v.pid || ""}</td>
        <td>${esc(v.state)}</td>
        <td class="num">${v.pid ? (cpuByPid.get(v.pid) ?? 0).toFixed(1) : ""}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#svc-table tbody")!.innerHTML = svcRows;
}

function renderMemory(s: Snapshot) {
  const m = s.memory;
  const counters = m.standby + m.modified + m.free > 0;
  const used = counters ? Math.max(m.total - m.standby - m.modified - m.free, 0) : m.used;
  const standby = counters ? m.standby : 0;
  const modified = counters ? m.modified : 0;
  const free = counters ? m.free : m.total - m.used;

  document.getElementById("mem-cards")!.innerHTML =
    card(
      "En uso",
      `${fmtBytes(used)} / ${fmtBytes(m.total)}`,
      `${((used / m.total) * 100).toFixed(1)}%`,
      sparkline(history.mem, 100, "#ba68c8"),
    ) +
    card(
      "Confirmada",
      `${fmtBytes(m.commit)}`,
      m.commit_limit ? `límite ${fmtBytes(m.commit_limit)} · ${((m.commit / m.commit_limit) * 100).toFixed(0)}%` : "",
      "",
    ) +
    card("En espera (caché)", fmtBytes(standby), `modificada ${fmtBytes(modified)}`, "") +
    card(
      "Fallos duros/s",
      m.hard_faults_ps.toFixed(0),
      "páginas leídas de disco por segundo",
      sparkline(history.faults, Math.max(...history.faults, 10), "#ffb74d"),
    );

  const segs = [
    { label: "En uso", value: used, color: "#ba68c8" },
    { label: "Modificada", value: modified, color: "#ffb74d" },
    { label: "En espera", value: standby, color: "#4fc3f7" },
    { label: "Libre", value: free, color: "#37474f" },
  ];
  const bar = segs
    .map((g) => `<div class="mem-seg" style="width:${((g.value / m.total) * 100).toFixed(2)}%;background:${g.color}"></div>`)
    .join("");
  const legend = segs
    .map(
      (g) => `<span class="legend-item"><span class="dot" style="background:${g.color}"></span>${g.label} · ${fmtBytes(g.value)}</span>`,
    )
    .join("");
  document.getElementById("mem-bar")!.innerHTML =
    `<div class="mem-bar">${bar}</div><div class="legend">${legend}</div>`;

  const rows = [...s.processes]
    .sort((a, b) => b.memory - a.memory)
    .slice(0, 50)
    .map(
      (p) => `<tr>
        <td>${esc(p.name)}</td>
        <td class="num">${p.pid}</td>
        <td class="num">${fmtBytes(p.memory)}</td>
        <td class="num">${fmtBytes(p.virtual_memory)}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#mem-table tbody")!.innerHTML = rows;
}

function renderProcesses(s: Snapshot) {
  const filter = (document.getElementById("proc-filter") as HTMLInputElement).value.toLowerCase();
  let procs = s.processes;
  if (filter) {
    procs = procs.filter((p) => p.name.toLowerCase().includes(filter) || String(p.pid) === filter);
  }
  procs = [...procs].sort((a, b) => {
    const va = a[procSortKey];
    const vb = b[procSortKey];
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return procSortAsc ? cmp : -cmp;
  });
  const rows = procs
    .map(
      (p) => `<tr>
        <td>${esc(p.name)}</td>
        <td class="num">${p.pid}</td>
        <td class="num">${p.threads}</td>
        <td class="num">${p.cpu.toFixed(1)}</td>
        <td class="num">${fmtBytes(p.memory)}</td>
        <td class="num">${fmtBytes(p.virtual_memory)}</td>
        <td class="num">${fmtBytes(p.read_bps, "/s")}</td>
        <td class="num">${fmtBytes(p.write_bps, "/s")}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#proc-table tbody")!.innerHTML = rows;
}

function isListening(c: Connection): boolean {
  return c.protocol === "UDP" || c.state.toUpperCase().includes("LISTEN");
}

function toggleEtw(noticeId: string, wrapId: string, etw: boolean) {
  (document.getElementById(noticeId) as HTMLElement).hidden = etw;
  (document.getElementById(wrapId) as HTMLElement).hidden = !etw;
}

function renderNetwork(s: Snapshot) {
  const nics = s.nics
    .filter((n) => n.rx_bps > 0 || n.tx_bps > 0 || s.nics.length <= 3)
    .map((n) => card(esc(n.name), `↓ ${fmtBytes(n.rx_bps, "/s")}`, `↑ ${fmtBytes(n.tx_bps, "/s")}`, ""))
    .join("");
  document.getElementById("nic-cards")!.innerHTML = nics;

  toggleEtw("net-etw-notice", "net-proc-wrap", s.etw);
  if (s.etw) {
    const netRows = s.net_procs
      .map(
        (p) => `<tr>
          <td>${esc(p.name)}</td>
          <td class="num">${p.pid}</td>
          <td class="num">${fmtBytes(p.sent_bps, "/s")}</td>
          <td class="num">${fmtBytes(p.recv_bps, "/s")}</td>
          <td class="num">${fmtBytes(p.sent_bps + p.recv_bps, "/s")}</td>
        </tr>`,
      )
      .join("");
    document.querySelector("#net-proc-table tbody")!.innerHTML = netRows;
  }

  const filter = (document.getElementById("conn-filter") as HTMLInputElement).value.toLowerCase();
  let conns = s.connections.filter((c) => !isListening(c));
  if (filter) {
    conns = conns.filter(
      (c) =>
        c.process.toLowerCase().includes(filter) ||
        c.remote.includes(filter) ||
        c.local.includes(filter) ||
        String(c.pid) === filter,
    );
  }
  const rows = conns
    .map(
      (c) => `<tr>
        <td>${esc(c.process)}</td>
        <td class="num">${c.pid}</td>
        <td>${c.protocol}</td>
        <td>${esc(c.local)}</td>
        <td>${esc(c.remote)}</td>
        <td>${esc(c.state)}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#conn-table tbody")!.innerHTML = rows;

  const listenRows = s.connections
    .filter(isListening)
    .sort((a, b) => a.process.localeCompare(b.process))
    .map(
      (c) => `<tr>
        <td>${esc(c.process)}</td>
        <td class="num">${c.pid}</td>
        <td>${c.protocol}</td>
        <td>${esc(c.local)}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#listen-table tbody")!.innerHTML = listenRows;
}

function renderDisk(s: Snapshot) {
  const read = s.processes.reduce((a, p) => a + p.read_bps, 0);
  const write = s.processes.reduce((a, p) => a + p.write_bps, 0);
  document.getElementById("disk-cards")!.innerHTML =
    card(
      "Lectura total",
      fmtBytes(read, "/s"),
      "",
      sparkline(history.read, Math.max(...history.read, 1024 * 512), "#4fc3f7"),
    ) +
    card(
      "Escritura total",
      fmtBytes(write, "/s"),
      "",
      sparkline(history.write, Math.max(...history.write, 1024 * 512), "#ffb74d"),
    );

  const storageRows = s.disks
    .map((d) => {
      const usedPct = d.total ? ((d.total - d.available) / d.total) * 100 : 0;
      return `<tr>
        <td>${esc(d.mount)} ${esc(d.name)}${d.removable ? " (extraíble)" : ""}</td>
        <td>${esc(d.fs)}</td>
        <td class="num">${usageBar(d.active_pct, "#81c784")}</td>
        <td class="num">${d.queue.toFixed(2)}</td>
        <td class="num">${fmtBytes(d.available)}</td>
        <td class="num">${fmtBytes(d.total)}</td>
        <td class="num">${usageBar(usedPct, "#ffb74d")}</td>
      </tr>`;
    })
    .join("");
  document.querySelector("#storage-table tbody")!.innerHTML = storageRows;

  toggleEtw("file-etw-notice", "file-act-wrap", s.etw);
  if (s.etw) {
    const fileRows = s.file_activity
      .map(
        (f) => `<tr>
          <td>${esc(f.name)}</td>
          <td class="num">${f.pid}</td>
          <td class="path" title="${esc(f.file)}">${esc(f.file)}</td>
          <td class="num">${fmtBytes(f.read_bps, "/s")}</td>
          <td class="num">${fmtBytes(f.write_bps, "/s")}</td>
        </tr>`,
      )
      .join("");
    document.querySelector("#file-act-table tbody")!.innerHTML = fileRows;
  }

  const rows = [...s.processes]
    .filter((p) => p.read_bps > 0 || p.write_bps > 0)
    .sort((a, b) => b.read_bps + b.write_bps - (a.read_bps + a.write_bps))
    .slice(0, 50)
    .map(
      (p) => `<tr>
        <td>${esc(p.name)}</td>
        <td class="num">${p.pid}</td>
        <td class="num">${fmtBytes(p.read_bps, "/s")}</td>
        <td class="num">${fmtBytes(p.write_bps, "/s")}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#disk-table tbody")!.innerHTML = rows;
}

function renderGpu(s: Snapshot) {
  const el = document.getElementById("gpu-cards")!;
  if (!s.gpu) {
    el.innerHTML = `<div class="card"><div class="card-title">GPU</div><div class="card-value">No disponible</div><div class="card-detail">No se detectó GPU NVIDIA (NVML)</div></div>`;
    document.querySelector("#gpu-table tbody")!.innerHTML = "";
    return;
  }
  const g = s.gpu;
  el.innerHTML =
    card("Uso", `${g.utilization}%`, esc(g.name), sparkline(history.gpu, 100, "#e57373")) +
    card("Reloj núcleo", `${g.clock_core} MHz`, `máx ${g.clock_core_max} MHz · estado ${esc(g.pstate)}`, "") +
    card("Reloj memoria", `${g.clock_mem} MHz`, `máx ${g.clock_mem_max} MHz`, "") +
    card("VRAM", `${fmtBytes(g.mem_used)} / ${fmtBytes(g.mem_total)}`, "", "") +
    card("Temperatura", `${g.temp}°C`, `${g.power_w.toFixed(1)} W`, "");

  const rows = g.processes
    .map(
      (p) => `<tr>
        <td>${esc(p.name)}</td>
        <td class="num">${p.pid}</td>
        <td>${esc(p.kind)}</td>
        <td class="num">${fmtBytes(p.vram)}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#gpu-table tbody")!.innerHTML = rows;
}

function render(s: Snapshot) {
  renderTopbar(s);
  if (activeTab === "overview") renderOverview(s);
  else if (activeTab === "cpu") renderCpu(s);
  else if (activeTab === "memory") renderMemory(s);
  else if (activeTab === "processes") renderProcesses(s);
  else if (activeTab === "network") renderNetwork(s);
  else if (activeTab === "disk") renderDisk(s);
  else if (activeTab === "gpu") renderGpu(s);
}

async function tick() {
  try {
    const s = await invoke<Snapshot>("get_snapshot");
    lastSnapshot = s;
    push(history.cpu, s.cpu.usage);
    push(history.mem, (s.memory.used / s.memory.total) * 100);
    push(history.rx, s.nics.reduce((a, n) => a + n.rx_bps, 0));
    push(history.tx, s.nics.reduce((a, n) => a + n.tx_bps, 0));
    push(history.gpu, s.gpu?.utilization ?? 0);
    push(history.read, s.processes.reduce((a, p) => a + p.read_bps, 0));
    push(history.write, s.processes.reduce((a, p) => a + p.write_bps, 0));
    push(history.faults, s.memory.hard_faults_ps);
    render(s);
  } catch (e) {
    console.error("snapshot error", e);
  }
}

function setupUi() {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab!;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.toggle("active", v.id === `view-${activeTab}`));
      if (lastSnapshot) render(lastSnapshot);
    });
  });

  document.querySelectorAll<HTMLTableCellElement>("#proc-table th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort as keyof ProcessSnapshot;
      if (procSortKey === key) {
        procSortAsc = !procSortAsc;
      } else {
        procSortKey = key;
        procSortAsc = key === "name";
      }
      if (lastSnapshot) renderProcesses(lastSnapshot);
    });
  });

  for (const id of ["proc-filter", "conn-filter", "svc-filter"]) {
    document.getElementById(id)!.addEventListener("input", () => {
      if (lastSnapshot) render(lastSnapshot);
    });
  }
}

setupUi();
tick();
setInterval(tick, POLL_MS);
