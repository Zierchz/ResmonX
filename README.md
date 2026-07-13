# ResmonX

A modern resource monitor for Windows — a lightweight alternative to Resource Monitor (`resmon`) and Task Manager, built with Tauri and Rust.

ResmonX polls the system about twice per second and renders live CPU, memory, disk, network and GPU metrics with rolling-history sparklines, severity-colored readings, and sortable per-process and per-service tables.

**Website:** https://zierchz.github.io/ResmonX/ — [download the latest installer](https://github.com/Zierchz/ResmonX/releases/latest/download/ResmonX-Setup.exe) (Windows 10/11).

## Features

Seven tabs, each backed by a single snapshot pulled from the Rust backend. Every section uses a two-column layout: sticky summary cards on the left, detailed tables and grids on the right.

- **Overview** — Summary cards for every resource plus a Task Manager–style process list (CPU, RAM, disk, network, threads) and a service list.
- **CPU** — Global usage and *effective* frequency (measured via PDH, not just the base clock), a per-logical-core bar grid colored by load, top processes by CPU, and the Windows service list with state badges.
- **Memory** — Physical composition bar (in use / modified / standby / free), committed charge vs. limit, cache, hard faults/sec, and processes by working set / virtual size.
- **Disk** — Aggregate read/write throughput, per-logical-drive storage (% active time, queue length, free/total, usage), per-file activity (ETW), and top processes by disk I/O.
- **Network** — Summary throughput and connections, per-interface RX/TX, per-process network activity (ETW), active TCP connections, and listening ports.
- **Processes** — Sortable, filterable table of every process: threads, CPU %, RAM, virtual size, disk read/write per second. Right-click for actions (see below).
- **GPU** — Core/memory clocks, VRAM, temperature, power draw, performance state (P-state) and the processes using the GPU. *(NVIDIA only, via NVML.)*

### Process context menu

Right-click any process row (Overview or Processes) for: **end process**, **end process tree**, **suspend**, **resume**, **open file location**, and **copy**. Destructive actions ask for confirmation; failures surface as a toast without crashing the app.

### Requires administrator

Some data comes from an ETW (Event Tracing for Windows) session and only appears when ResmonX runs elevated: **per-process network traffic** and **per-file disk activity**. Without elevation those two sections show a notice and the rest of the app works normally. Suspending or ending protected system processes also requires elevation.

## Tech stack

- **[Tauri 2](https://tauri.app)** — Rust backend + WebView2 frontend: small binaries, no bundled browser.
- **Backend (Rust):**
  - [`sysinfo`](https://crates.io/crates/sysinfo) — CPU, memory, processes, per-interface network, disks.
  - [`netstat2`](https://crates.io/crates/netstat2) — TCP/UDP connection table.
  - [`nvml-wrapper`](https://crates.io/crates/nvml-wrapper) — NVIDIA GPU metrics.
  - [`ferrisetw`](https://crates.io/crates/ferrisetw) — ETW session for per-process network and per-file disk I/O.
  - [`windows`](https://crates.io/crates/windows) — PDH counters (CPU frequency, memory & per-disk counters), Windows services (SCM), process/thread control, Toolhelp snapshots.
- **Frontend:** Vanilla TypeScript + [Vite](https://vitejs.dev). No UI framework; charts are hand-rendered inline SVG. Uses the Tauri opener and clipboard-manager plugins.

## How it works

The backend exposes one polling command, `get_snapshot`, which refreshes every subsystem and returns a single JSON `Snapshot`. The frontend calls it every 1.5 s, appends each metric to a 120-sample ring buffer for the sparklines, and re-renders the active tab. Process actions are separate commands (`kill_process`, `kill_process_tree`, `suspend_process`, `resume_process`).

The ETW session runs on its own background thread; its callbacks aggregate byte counts per process and per file into bounded maps that the poll drains each tick. If the session can't start (not elevated), the monitor reports itself unavailable and the app degrades gracefully.

Effective CPU frequency is derived from the PDH counter `\Processor Information(_Total)\% Processor Performance` (the English counter name, so it works on localized Windows) multiplied by the base clock — this reflects turbo/throttling that the base frequency alone hides.

## Project structure

```
resmonx/
├── index.html            # app shell + tab markup
├── src/                  # frontend (TypeScript + Vite)
│   ├── main.ts           # polling, state, rendering, context menu
│   └── styles.css
└── src-tauri/            # backend (Rust)
    ├── src/
    │   ├── lib.rs        # Tauri builder + command registration
    │   ├── main.rs
    │   └── monitor/
    │       ├── mod.rs        # snapshot aggregation, get_snapshot
    │       ├── cpufreq.rs    # effective CPU frequency (PDH)
    │       ├── pdh.rs        # memory & per-disk PDH counters
    │       ├── gpu.rs        # NVIDIA GPU (NVML)
    │       ├── net.rs        # TCP/UDP connections (netstat2)
    │       ├── services.rs   # Windows services (SCM)
    │       ├── threads.rs    # per-process thread counts (Toolhelp)
    │       ├── etw.rs        # ETW: per-process net, per-file disk I/O
    │       └── control.rs    # kill / suspend / resume commands
    ├── Cargo.toml
    └── tauri.conf.json
```

## Requirements

- **Windows 10/11** — the app relies on Windows-specific APIs (PDH, ETW, SCM, WebView2).
- **Rust** with the MSVC toolchain.
- **Node.js 18+**.
- **Visual Studio Build Tools** with the MSVC compiler (`VC.Tools.x86.x64`) and the Windows SDK.
- **WebView2** runtime (preinstalled on Windows 11).

## Development

```sh
npm install
npm run tauri dev
```

Starts Vite and the Tauri shell with hot reload. Run the terminal as administrator to exercise the ETW-backed sections.

## Build

```sh
npm run tauri build
```

Produces a standalone `resmonx.exe` plus MSI and NSIS installers under `src-tauri/target/release/`. The release binary embeds the frontend, so it runs without the dev server.

## Roadmap / Limitations

- GPU metrics are **NVIDIA only** (NVML); AMD/Intel are not yet supported.
- ETW features (per-process network, per-file disk) require running **as administrator**.
- Not yet implemented from resmon's feature set: TCP latency / packet loss per connection, associated handles and modules.
