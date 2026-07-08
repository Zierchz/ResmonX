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
}

interface ProcessSnapshot {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
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
  gpu: GpuSnapshot | null;
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        <td class="num">${p.cpu.toFixed(1)}</td>
        <td class="num">${fmtBytes(p.memory)}</td>
        <td class="num">${fmtBytes(p.read_bps, "/s")}</td>
        <td class="num">${fmtBytes(p.write_bps, "/s")}</td>
      </tr>`,
    )
    .join("");
  document.querySelector("#proc-table tbody")!.innerHTML = rows;
}

function renderNetwork(s: Snapshot) {
  const nics = s.nics
    .filter((n) => n.rx_bps > 0 || n.tx_bps > 0 || s.nics.length <= 3)
    .map((n) => card(esc(n.name), `↓ ${fmtBytes(n.rx_bps, "/s")}`, `↑ ${fmtBytes(n.tx_bps, "/s")}`, ""))
    .join("");
  document.getElementById("nic-cards")!.innerHTML = nics;

  const filter = (document.getElementById("conn-filter") as HTMLInputElement).value.toLowerCase();
  let conns = s.connections;
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

  for (const id of ["proc-filter", "conn-filter"]) {
    document.getElementById(id)!.addEventListener("input", () => {
      if (lastSnapshot) render(lastSnapshot);
    });
  }
}

setupUi();
tick();
setInterval(tick, POLL_MS);
