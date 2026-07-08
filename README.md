# ResmonX

A modern resource monitor for Windows — a lightweight alternative to Resource Monitor (`resmon`) and Task Manager, built with Tauri and Rust.

ResmonX polls the system about twice per second and renders live CPU, memory, network, disk and GPU metrics with rolling-history sparklines, plus sortable per-process tables.

## Features

Five tabs, each backed by a single snapshot pulled from the Rust backend:

- **Overview** — At-a-glance cards for CPU, memory, network, disk and GPU, each with a rolling sparkline (last 120 samples). CPU shows usage and *effective* frequency (measured via PDH, not just the base clock).
- **Processes** — Sortable, filterable table of every process: CPU %, RAM, and disk read/write per second. CPU usage is normalized across cores.
- **Network** — Per-interface throughput (RX/TX) plus a table of active TCP/UDP connections with the owning process, local/remote endpoints and connection state.
- **Disk** — Aggregate read/write throughput and the top processes by disk I/O.
- **GPU** — Core/memory clocks, VRAM usage, temperature, power draw, performance state (P-state) and the processes using the GPU. *(NVIDIA only, via NVML.)*

## Tech stack

- **[Tauri 2](https://tauri.app)** — Rust backend + WebView2 frontend: small binaries, no bundled browser.
- **Backend (Rust):**
  - [`sysinfo`](https://crates.io/crates/sysinfo) — CPU, memory, processes, per-interface network.
  - [`netstat2`](https://crates.io/crates/netstat2) — TCP/UDP connection table.
  - [`nvml-wrapper`](https://crates.io/crates/nvml-wrapper) — NVIDIA GPU metrics.
  - [`windows`](https://crates.io/crates/windows) — PDH counters for effective CPU frequency (`% Processor Performance`).
- **Frontend:** Vanilla TypeScript + [Vite](https://vitejs.dev). No UI framework; charts are hand-rendered inline SVG.

## How it works

The backend exposes a single Tauri command, `get_snapshot`, which refreshes all subsystems and returns one JSON `Snapshot`. The frontend calls it every 1.5 s, appends each metric to a 120-sample ring buffer for the sparklines, and re-renders the active tab.

Effective CPU frequency is derived from the PDH counter `\Processor Information(_Total)\% Processor Performance` (the English counter name, so it works on localized Windows) multiplied by the base clock — this reflects turbo/throttling that the base frequency alone hides.

## Project structure

```
resmonx/
├── index.html            # app shell + tab markup
├── src/                  # frontend (TypeScript + Vite)
│   ├── main.ts           # polling, state, rendering
│   └── styles.css
└── src-tauri/            # backend (Rust)
    ├── src/
    │   ├── lib.rs        # Tauri builder + command registration
    │   ├── main.rs
    │   └── monitor/
    │       ├── mod.rs      # snapshot aggregation, get_snapshot
    │       ├── cpufreq.rs  # effective CPU frequency (PDH)
    │       ├── gpu.rs      # NVIDIA GPU (NVML)
    │       └── net.rs      # TCP/UDP connections (netstat2)
    ├── Cargo.toml
    └── tauri.conf.json
```

## Requirements

- **Windows 10/11** — the app relies on Windows-specific APIs (PDH, WebView2).
- **Rust** with the MSVC toolchain.
- **Node.js 18+**.
- **Visual Studio Build Tools** with the Windows SDK.
- **WebView2** runtime (preinstalled on Windows 11).

## Development

```sh
npm install
npm run tauri dev
```

Starts Vite and the Tauri shell with hot reload.

## Build

```sh
npm run tauri build
```

Produces a release binary and installer under `src-tauri/target/release/`.

## Roadmap / Limitations

- GPU metrics are **NVIDIA only** (NVML); AMD/Intel are not yet supported.
- Disk I/O is aggregated **per process**, not per file — per-file I/O would require ETW and running as administrator.
- Network traffic is reported **per interface**, not per process — per-process traffic also requires ETW.
