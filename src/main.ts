import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

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
  exe: string;
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

// acento único para sparklines y valores (coincide con --accent en CSS)
const ACCENT = "#6d8db3";
const COLORS = {
  cpu: ACCENT,
  mem: ACCENT,
  net: ACCENT,
  disk: ACCENT,
  gpu: ACCENT,
};

// clase de severidad según porcentaje de uso
function sevClass(pct: number): string {
  if (pct >= 85) return "sev-crit";
  if (pct >= 60) return "sev-warn";
  return "sev-ok";
}

// fondo tipo heatmap (estilo Task Manager): naranja translúcido por intensidad
function heat(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  if (r < 0.015) return "";
  return ` style="background:rgba(255,140,0,${(0.07 + 0.4 * r).toFixed(3)})"`;
}

// iconos de procesos: cache por ruta + carga diferida vía backend
const iconCache = new Map<string, string | null>();
const iconInflight = new Set<string>();

function procIcon(exe: string): string {
  if (!exe) return `<img class="pico" alt="">`;
  const cached = iconCache.get(exe);
  const src = cached ? ` src="${cached}"` : "";
  return `<img class="pico" alt="" data-exe="${esc(exe)}"${src}>`;
}

function hydrateIcons() {
  const pending = document.querySelectorAll<HTMLImageElement>("img.pico:not([src])");
  const need = new Set<string>();
  pending.forEach((img) => {
    const exe = img.dataset.exe;
    if (!exe) return;
    const cached = iconCache.get(exe);
    if (cached) img.src = cached;
    else if (cached === undefined) need.add(exe);
  });
  need.forEach((exe) => {
    if (iconInflight.has(exe)) return;
    iconInflight.add(exe);
    invoke<string | null>("get_icon", { path: exe })
      .then((uri) => {
        iconCache.set(exe, uri ?? null);
        iconInflight.delete(exe);
        if (!uri) return;
        document.querySelectorAll<HTMLImageElement>("img.pico").forEach((img) => {
          if (img.dataset.exe === exe && !img.getAttribute("src")) img.src = uri;
        });
      })
      .catch(() => iconInflight.delete(exe));
  });
}

function card(title: string, value: string, detail: string, spark: string, accent = ""): string {
  const style = accent ? ` style="--card-accent:${accent}"` : "";
  return `<div class="card"${style}>
    <div class="card-title">${title}</div>
    <div class="card-value">${value}</div>
    <div class="card-detail">${detail}</div>
    ${spark}
  </div>`;
}

function usageBar(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `<span class="usage-bar"><span class="usage-fill ${sevClass(p)}" style="width:${p.toFixed(0)}%"></span></span>${p.toFixed(0)}%`;
}

function badge(state: string): string {
  const cls = state === "En ejecución" ? "badge-run" : state === "Detenido" ? "badge-stop" : "badge-other";
  return `<span class="badge ${cls}">${esc(state)}</span>`;
}

function renderTopbar(s: Snapshot) {
  document.getElementById("top-cpu")!.textContent = `CPU ${s.cpu.usage.toFixed(0)}%`;
  document.getElementById("top-freq")!.textContent = `${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz`;
  const memPct = (s.memory.used / s.memory.total) * 100;
  document.getElementById("top-mem")!.textContent = `RAM ${memPct.toFixed(0)}%`;
  document.getElementById("top-gpu")!.textContent = s.gpu ? `GPU ${s.gpu.utilization}%` : "GPU n/d";
}

// --- Cards canónicas (idénticas en Resumen y en cada sección) ---

function cpuCard(s: Snapshot): string {
  return card(
    "CPU",
    `${s.cpu.usage.toFixed(1)}%`,
    `${esc(s.cpu.name)} · ${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz efectivos · ${s.cpu.cores} núcleos`,
    sparkline(history.cpu, 100, COLORS.cpu),
    COLORS.cpu,
  );
}

function memCard(s: Snapshot): string {
  return card(
    "Memoria",
    `${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`,
    `${((s.memory.used / s.memory.total) * 100).toFixed(1)}% · swap ${fmtBytes(s.memory.swap_used)}`,
    sparkline(history.mem, 100, COLORS.mem),
    COLORS.mem,
  );
}

function netCard(s: Snapshot): string {
  const rx = s.nics.reduce((a, n) => a + n.rx_bps, 0);
  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  return card(
    "Red",
    `↓ ${fmtBytes(rx, "/s")} · ↑ ${fmtBytes(tx, "/s")}`,
    `${s.connections.length} conexiones activas`,
    sparkline(history.rx, Math.max(...history.rx, 1024 * 128), COLORS.net),
    COLORS.net,
  );
}

function diskCard(s: Snapshot): string {
  const read = s.processes.reduce((a, p) => a + p.read_bps, 0);
  const write = s.processes.reduce((a, p) => a + p.write_bps, 0);
  return card(
    "Disco",
    `R ${fmtBytes(read, "/s")} · W ${fmtBytes(write, "/s")}`,
    "I/O agregado por procesos",
    sparkline(history.write, Math.max(...history.write, 1024 * 512), COLORS.disk),
    COLORS.disk,
  );
}

function gpuCard(s: Snapshot): string {
  if (!s.gpu) return "";
  return card(
    "GPU",
    `${s.gpu.utilization}% · ${s.gpu.clock_core} MHz`,
    `${esc(s.gpu.name)} · ${fmtBytes(s.gpu.mem_used)} VRAM · ${s.gpu.temp}°C · ${s.gpu.power_w.toFixed(1)} W · ${esc(s.gpu.pstate)}`,
    sparkline(history.gpu, 100, COLORS.gpu),
    COLORS.gpu,
  );
}

interface ColMax {
  mem: number;
  disk: number;
  net: number;
}

function procRow(p: ProcessSnapshot, netByPid: Map<number, number>, etw: boolean, max: ColMax): string {
  const netBps = netByPid.get(p.pid) ?? 0;
  const net = etw ? fmtBytes(netBps, "/s") : "—";
  const io = p.read_bps + p.write_bps;
  return `<tr data-pid="${p.pid}" data-name="${esc(p.name)}" data-exe="${esc(p.exe)}">
    <td class="pname">${procIcon(p.exe)}${esc(p.name)}</td>
    <td class="num">${p.pid}</td>
    <td class="num"${heat(p.cpu / 100)}>${p.cpu.toFixed(1)}</td>
    <td class="num"${heat(p.memory / max.mem)}>${fmtBytes(p.memory)}</td>
    <td class="num"${heat(io / max.disk)}>${fmtBytes(io, "/s")}</td>
    <td class="num"${etw ? heat(netBps / max.net) : ""}>${net}</td>
    <td class="num">${p.threads}</td>
  </tr>`;
}

function serviceRows(s: Snapshot): string {
  return [...s.services]
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
        <td>${badge(v.state)}</td>
      </tr>`,
    )
    .join("");
}

function renderOverview(s: Snapshot) {
  const cards = [cpuCard(s), memCard(s), netCard(s), diskCard(s)];
  if (s.gpu) cards.push(gpuCard(s));
  document.getElementById("overview-cards")!.innerHTML = cards.join("");

  const netByPid = new Map(s.net_procs.map((p) => [p.pid, p.sent_bps + p.recv_bps]));
  const top = s.processes.slice(0, 60);
  const max: ColMax = {
    mem: Math.max(1, ...top.map((p) => p.memory)),
    disk: Math.max(1, ...top.map((p) => p.read_bps + p.write_bps)),
    net: Math.max(1, ...top.map((p) => netByPid.get(p.pid) ?? 0)),
  };
  const procRows = top.map((p) => procRow(p, netByPid, s.etw, max)).join("");
  document.querySelector("#ov-proc-table tbody")!.innerHTML = procRows;

  document.querySelector("#ov-svc-table tbody")!.innerHTML = serviceRows(s);
}

function renderCpu(s: Snapshot) {
  const totalThreads = s.processes.reduce((a, p) => a + p.threads, 0);
  document.getElementById("cpu-cards")!.innerHTML =
    cpuCard(s) +
    card(
      "Frecuencia efectiva",
      `${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz`,
      `base ${(s.cpu.base_mhz / 1000).toFixed(2)} GHz`,
      "",
      COLORS.cpu,
    ) +
    card(
      "Procesos",
      `${s.processes.length}`,
      `${totalThreads} hilos · ${s.cpu.cores} núcleos lógicos`,
      "",
      COLORS.cpu,
    );

  document.getElementById("core-grid")!.innerHTML = s.cpu.per_core
    .map(
      (u, i) => `<div class="core-cell">
        <div class="core-label"><span>N${i}</span><span>${u.toFixed(0)}%</span></div>
        <div class="core-track"><div class="core-fill ${sevClass(u)}" style="width:${Math.min(u, 100).toFixed(0)}%"></div></div>
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
        <td>${badge(v.state)}</td>
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
    memCard(s) +
    card(
      "Confirmada",
      `${fmtBytes(m.commit)}`,
      m.commit_limit ? `límite ${fmtBytes(m.commit_limit)} · ${((m.commit / m.commit_limit) * 100).toFixed(0)}%` : "",
      "",
      COLORS.mem,
    ) +
    card("En espera (caché)", fmtBytes(standby), `modificada ${fmtBytes(modified)}`, "", COLORS.mem) +
    card(
      "Fallos duros/s",
      m.hard_faults_ps.toFixed(0),
      "páginas leídas de disco por segundo",
      sparkline(history.faults, Math.max(...history.faults, 10), COLORS.mem),
      COLORS.mem,
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
  const maxMem = Math.max(1, ...procs.map((p) => p.memory));
  const maxRead = Math.max(1, ...procs.map((p) => p.read_bps));
  const maxWrite = Math.max(1, ...procs.map((p) => p.write_bps));
  const rows = procs
    .map(
      (p) => `<tr data-pid="${p.pid}" data-name="${esc(p.name)}" data-exe="${esc(p.exe)}">
        <td class="pname">${procIcon(p.exe)}${esc(p.name)}</td>
        <td class="num">${p.pid}</td>
        <td class="num">${p.threads}</td>
        <td class="num"${heat(p.cpu / 100)}>${p.cpu.toFixed(1)}</td>
        <td class="num"${heat(p.memory / maxMem)}>${fmtBytes(p.memory)}</td>
        <td class="num">${fmtBytes(p.virtual_memory)}</td>
        <td class="num"${heat(p.read_bps / maxRead)}>${fmtBytes(p.read_bps, "/s")}</td>
        <td class="num"${heat(p.write_bps / maxWrite)}>${fmtBytes(p.write_bps, "/s")}</td>
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
  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  const activeNics = s.nics.filter((n) => n.rx_bps > 0 || n.tx_bps > 0).length;
  document.getElementById("net-summary-cards")!.innerHTML =
    netCard(s) +
    card(
      "Subida",
      fmtBytes(tx, "/s"),
      `${activeNics} interfaces activas`,
      sparkline(history.tx, Math.max(...history.tx, 1024 * 128), COLORS.net),
      COLORS.net,
    ) +
    card("Conexiones", `${s.connections.length}`, "TCP/UDP activas y en escucha", "", COLORS.net);

  const nics = s.nics
    .filter((n) => n.rx_bps > 0 || n.tx_bps > 0 || s.nics.length <= 3)
    .map((n) => card(esc(n.name), `↓ ${fmtBytes(n.rx_bps, "/s")}`, `↑ ${fmtBytes(n.tx_bps, "/s")}`, "", COLORS.net))
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
  const busiest = s.disks.reduce((m, d) => Math.max(m, d.active_pct), 0);
  document.getElementById("disk-cards")!.innerHTML =
    diskCard(s) +
    card(
      "Lectura total",
      fmtBytes(read, "/s"),
      "",
      sparkline(history.read, Math.max(...history.read, 1024 * 512), COLORS.disk),
      COLORS.disk,
    ) +
    card(
      "Escritura total",
      fmtBytes(write, "/s"),
      "",
      sparkline(history.write, Math.max(...history.write, 1024 * 512), COLORS.disk),
      COLORS.disk,
    ) +
    card("Unidad más activa", `${busiest.toFixed(0)}%`, `${s.disks.length} unidades`, "", COLORS.disk);

  const storageRows = s.disks
    .map((d) => {
      const usedPct = d.total ? ((d.total - d.available) / d.total) * 100 : 0;
      return `<tr>
        <td>${esc(d.mount)} ${esc(d.name)}${d.removable ? " (extraíble)" : ""}</td>
        <td>${esc(d.fs)}</td>
        <td class="num">${usageBar(d.active_pct)}</td>
        <td class="num">${d.queue.toFixed(2)}</td>
        <td class="num">${fmtBytes(d.available)}</td>
        <td class="num">${fmtBytes(d.total)}</td>
        <td class="num">${usageBar(usedPct)}</td>
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
    card("Uso", `${g.utilization}%`, esc(g.name), sparkline(history.gpu, 100, COLORS.gpu), COLORS.gpu) +
    card("Reloj núcleo", `${g.clock_core} MHz`, `máx ${g.clock_core_max} MHz · estado ${esc(g.pstate)}`, "", COLORS.gpu) +
    card("Reloj memoria", `${g.clock_mem} MHz`, `máx ${g.clock_mem_max} MHz`, "", COLORS.gpu) +
    card("VRAM", `${fmtBytes(g.mem_used)} / ${fmtBytes(g.mem_total)}`, "", "", COLORS.gpu) +
    card("Temperatura", `${g.temp}°C`, `${g.power_w.toFixed(1)} W`, "", COLORS.gpu);

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

// --- Toast, confirmación y menú contextual ---

function toast(msg: string, error = false) {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.textContent = msg;
  document.getElementById("toast-host")!.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-overlay")!;
    document.getElementById("confirm-msg")!.textContent = message;
    overlay.hidden = false;
    const done = (ok: boolean) => {
      overlay.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(ok);
    };
    const okBtn = document.getElementById("confirm-ok")!;
    const cancelBtn = document.getElementById("confirm-cancel")!;
    const onOk = () => done(true);
    const onCancel = () => done(false);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

interface CtxTarget {
  pid: number;
  name: string;
  exe: string;
}

function closeCtxMenu() {
  document.getElementById("ctx-menu")!.hidden = true;
  document.querySelectorAll("tr.selected").forEach((r) => r.classList.remove("selected"));
}

async function runAction(action: string, t: CtxTarget) {
  try {
    if (action === "kill") {
      if (await confirmDialog(`¿Finalizar el proceso "${t.name}" (PID ${t.pid})?`)) {
        await invoke("kill_process", { pid: t.pid });
        toast(`Proceso ${t.name} finalizado`);
      }
    } else if (action === "kill-tree") {
      if (await confirmDialog(`¿Finalizar "${t.name}" (PID ${t.pid}) y todos sus procesos hijos?`)) {
        await invoke("kill_process_tree", { pid: t.pid });
        toast(`Árbol de ${t.name} finalizado`);
      }
    } else if (action === "suspend") {
      await invoke("suspend_process", { pid: t.pid });
      toast(`Proceso ${t.name} suspendido`);
    } else if (action === "resume") {
      await invoke("resume_process", { pid: t.pid });
      toast(`Proceso ${t.name} reanudado`);
    } else if (action === "reveal") {
      await revealItemInDir(t.exe);
    } else if (action === "copy") {
      await writeText(`${t.name} (PID ${t.pid})`);
      toast("Copiado al portapapeles");
    }
  } catch (e) {
    toast(`Error: ${e}`, true);
  }
}

function openCtxMenu(x: number, y: number, t: CtxTarget) {
  const menu = document.getElementById("ctx-menu")!;
  const hasExe = t.exe.length > 0;
  const items = [
    { action: "kill", label: "Finalizar proceso", cls: "danger" },
    { action: "kill-tree", label: "Finalizar árbol de procesos", cls: "danger" },
    { sep: true },
    { action: "suspend", label: "Suspender" },
    { action: "resume", label: "Reanudar" },
    { sep: true },
    { action: "reveal", label: "Abrir ubicación del archivo", disabled: !hasExe },
    { action: "copy", label: "Copiar" },
  ];
  menu.innerHTML = items
    .map((it) =>
      it.sep
        ? `<div class="ctx-sep"></div>`
        : `<div class="ctx-item ${it.cls ?? ""}${it.disabled ? " disabled" : ""}" data-action="${it.action}">${it.label}</div>`,
    )
    .join("");
  menu.hidden = false;
  // ajustar para no salirse de la ventana
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 6);
  const py = Math.min(y, window.innerHeight - rect.height - 6);
  menu.style.left = `${Math.max(4, px)}px`;
  menu.style.top = `${Math.max(4, py)}px`;

  menu.querySelectorAll<HTMLElement>(".ctx-item[data-action]").forEach((el) => {
    el.addEventListener(
      "click",
      () => {
        closeCtxMenu();
        runAction(el.dataset.action!, t);
      },
      { once: true },
    );
  });
}

function setupContextMenu() {
  // funciona en cualquier tabla con filas data-pid (Resumen y Procesos)
  document.addEventListener("contextmenu", (ev) => {
    const e = ev as MouseEvent;
    const row = (e.target as HTMLElement).closest("tr[data-pid]") as HTMLElement | null;
    if (!row) return;
    e.preventDefault();
    document.querySelectorAll("tr.selected").forEach((r) => r.classList.remove("selected"));
    row.classList.add("selected");
    openCtxMenu(e.clientX, e.clientY, {
      pid: Number(row.dataset.pid),
      name: row.dataset.name ?? "",
      exe: row.dataset.exe ?? "",
    });
  });

  // cerrar el menú ante cualquier interacción externa
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#ctx-menu")) closeCtxMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCtxMenu();
  });
  document.querySelector("main")!.addEventListener("scroll", closeCtxMenu, true);
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
  hydrateIcons();
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

// título mostrado en la barra superior por sección
const TITLES: Record<string, string> = {
  overview: "Resumen",
  cpu: "CPU",
  memory: "Memoria",
  disk: "Disco",
  network: "Red",
  processes: "Procesos",
  gpu: "GPU",
};

function setupUi() {
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((btn) => {
    const tab = btn.dataset.tab!;
    btn.addEventListener("click", () => {
      activeTab = tab;
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b === btn));
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.toggle("active", v.id === `view-${activeTab}`));
      document.getElementById("view-title")!.textContent = TITLES[tab] ?? "";
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

  setupContextMenu();
}

setupUi();
tick();
setInterval(tick, POLL_MS);
