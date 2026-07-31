# ResmonX

A modern resource monitor for Windows — a lightweight alternative to Resource Monitor (`resmon`) and Task Manager, built with Tauri and Rust.

ResmonX polls the system about twice per second and renders live CPU, memory, disk, network, GPU and battery metrics with rolling-history sparklines, severity-colored readings, and sortable per-process and per-service tables.

**Website:** https://zierchz.github.io/ResmonX/ — [download the latest installer](https://github.com/Zierchz/ResmonX/releases/latest/download/ResmonX-Setup.exe) (Windows 10/11).

## Features

Eight tabs, each backed by a single snapshot pulled from the Rust backend. Every section uses a two-column layout: sticky summary cards on the left, detailed tables and grids on the right.

- **Overview** — Summary cards for every resource plus a Task Manager–style process list (CPU, RAM, disk, network, threads) and a service list.
- **CPU** — Global usage and *effective* frequency (measured via PDH, not just the base clock), a per-logical-core bar grid colored by load, top processes by CPU, and the Windows service list with state badges.
- **Memory** — Physical composition bar (in use / modified / standby / free), committed charge vs. limit, cache, hard faults/sec, and processes by working set / virtual size.
- **Disk** — Aggregate read/write throughput, per-logical-drive storage (% active time, queue length, free/total, usage), per-file activity (ETW), and top processes by disk I/O.
- **Network** — Summary throughput and connections, per-interface RX/TX, per-process network activity (ETW, listing every process so rows don't come and go between refreshes), active TCP connections, listening ports, and the active block rules.
- **Processes** — Sortable, filterable table of every process: threads, CPU %, RAM, virtual size, disk read/write per second. Right-click for actions (see below).
- **GPU** — Core/memory clocks, VRAM, temperature, power draw, performance state (P-state) and the processes using the GPU. *(NVIDIA only, via NVML.)*
- **Battery** — Charge level and state, power draw with a sparkline, estimated time remaining, health (full-charge vs. design capacity), capacity, voltage and Windows battery saver. *(Desktops without a battery show a notice.)*

### Process context menu

Right-click any process row — in Overview, Processes, the Network tables or the floating widget — for: **end process**, **end process tree**, **suspend**, **resume**, **open file location**, and **copy**. Destructive actions ask for confirmation; failures surface as a toast without crashing the app.

### Network control

Connection rows add three actions on top of the process ones:

- **Close connection** — drops that single TCP connection without touching the process. Available for TCP over IPv4; Windows exposes no IPv6 equivalent, so those rows show it disabled.
- **Block the process's network** and **block remote IP** — block rules on the Windows Filtering Platform, applied from user mode with no kernel driver (the same mechanism [simplewall](https://github.com/henrypp/simplewall) uses). Blocking also closes the live TCP connections, because a filter is only consulted when a connection is established. WFP matches on the image path, so blocking a process blocks *every* instance of that executable.

Active rules appear in the Network section's **Rules** subtab and can be lifted there. They are deliberately temporary: Windows drops all of them when ResmonX exits, so a forgotten block can never leave an app offline.

Bandwidth limiting is out of scope — throttling packets requires a kernel-mode driver, which ResmonX does not install.

### Beyond the tabs

- **Floating widget & system tray** — an always-on-top translucent widget with live mini-cards and the process list, right-click menu included. Closing the main window minimizes to the tray; monitoring keeps running in the background.
- **Performance alerts** — a native Windows notification fires when CPU, RAM or disk stays above its threshold for ~15 s, naming the top consuming process. Thresholds are configurable per metric and alerts also work from the tray.
- **In-app updater** — checks for new releases and installs signed updates in place, preserving pins and settings.
- **Start with Windows** — optional autostart; when launched at sign-in, ResmonX starts minimized in the tray.
- **Bilingual UI** — Spanish and English; follows the system language unless you pick one.

### Elevation (UAC prompt)

The window itself runs unelevated; at startup ResmonX asks for elevation (UAC) to spawn a helper copy of the executable that does the monitoring and serves it over a named pipe. ETW-backed data — **per-process network traffic** and **per-file disk activity** — only appears with the elevated helper. If you decline the prompt, those two sections show a notice and the rest of the app works normally. Suspending or ending protected system processes needs elevation too, as does everything under [Network control](#network-control): closing a connection and adding block rules both go through the elevated helper.

## Tech stack

- **[Tauri 2](https://tauri.app)** — Rust backend + WebView2 frontend: small binaries, no bundled browser.
- **Backend (Rust):**
  - [`sysinfo`](https://crates.io/crates/sysinfo) — CPU, memory, processes, per-interface network, disks.
  - [`netstat2`](https://crates.io/crates/netstat2) — TCP/UDP connection table.
  - [`nvml-wrapper`](https://crates.io/crates/nvml-wrapper) — NVIDIA GPU metrics.
  - [`ferrisetw`](https://crates.io/crates/ferrisetw) — ETW session for per-process network and per-file disk I/O.
  - [`windows`](https://crates.io/crates/windows) — PDH counters (CPU frequency, memory & per-disk counters), Windows services (SCM), process/thread control, Toolhelp snapshots, battery IOCTLs, named pipes, the Windows Filtering Platform (block rules) and IP Helper (closing TCP connections).
- **Frontend:** [React](https://react.dev) + [Vite](https://vitejs.dev), [Tailwind CSS](https://tailwindcss.com) v4, [shadcn/ui](https://ui.shadcn.com) (Radix primitives) and [TanStack Table](https://tanstack.com/table). Charts (sparklines, donut) are hand-rendered inline SVG. Uses the Tauri opener, clipboard-manager, updater, process, notification and autostart plugins.

## How it works

The backend exposes one polling command, `get_snapshot`, which refreshes every subsystem and returns a single JSON `Snapshot`. The frontend calls it every 1.5 s, appends each metric to a 120-sample ring buffer for the sparklines, and re-renders the active tab. Actions are separate commands (`kill_process`, `kill_process_tree`, `suspend_process`, `resume_process`, `close_connection`, `block_process_net`, `block_remote_ip`, `remove_firewall_rule`).

Monitoring runs in an elevated helper process (the same executable with `--helper`, spawned via UAC at startup) that serves snapshots to the unelevated window over a named pipe; when the app is already elevated, or the prompt is declined, monitoring runs in-process instead.

The ETW session runs on its own background thread; its callbacks aggregate byte counts per process and per file into bounded maps that the poll drains each tick. If the session can't start (not elevated), the monitor reports itself unavailable and the app degrades gracefully.

Block rules live in a dynamic WFP session owned by the helper process, which is what makes them non-persistent: Windows deletes every filter when that process exits. Closing a single connection maps the row the UI shows back to a live entry of the TCP table and deletes its TCB, so no address parsed in the frontend is ever trusted.

Effective CPU frequency is derived from the PDH counter `\Processor Information(_Total)\% Processor Performance` (the English counter name, so it works on localized Windows) multiplied by the base clock — this reflects turbo/throttling that the base frequency alone hides.

## Project structure

```
resmonx/
├── index.html            # mounts the React root
├── src/                  # frontend (React + Vite)
│   ├── main.tsx          # React entry
│   ├── App.tsx           # shell: sidebar + topbar + active-tab state
│   ├── index.css         # Tailwind + design tokens
│   ├── hooks/            # useSnapshot (polling), useIcon, useUpdate
│   ├── lib/              # types, tauri wrappers, format, filters, i18n, alerts
│   └── components/       # views/, cards/, tables/, process/, layout/, ui/ (shadcn)
└── src-tauri/            # backend (Rust)
    ├── src/
    │   ├── lib.rs        # Tauri builder + command registration
    │   ├── main.rs
    │   ├── ipc.rs        # elevated helper: UAC spawn + named pipe
    │   ├── commands.rs   # Backend enum (local / remote) + command wrappers
    │   └── monitor/
    │       ├── mod.rs        # snapshot aggregation, get_snapshot
    │       ├── cpufreq.rs    # effective CPU frequency (PDH)
    │       ├── pdh.rs        # memory & per-disk PDH counters
    │       ├── gpu.rs        # NVIDIA GPU (NVML)
    │       ├── battery.rs    # battery status (IOCTLs)
    │       ├── net.rs        # TCP/UDP connections (netstat2)
    │       ├── services.rs   # Windows services (SCM)
    │       ├── threads.rs    # per-process thread counts (Toolhelp)
    │       ├── procmem.rs    # working sets of protected processes
    │       ├── icons.rs      # exe icon extraction
    │       ├── etw.rs        # ETW: per-process net, per-file disk I/O
    │       ├── firewall.rs   # per-app / per-IP block rules (WFP)
    │       └── control.rs    # kill / suspend / resume, close TCP connection
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
- **No bandwidth limiting.** Rate limiting means holding packets back, which only a kernel-mode driver can do; ResmonX blocks or allows, it does not throttle.
- Closing a single connection is **IPv4-only** — Windows ships no public IPv6 counterpart to `SetTcpEntry`. Block rules do cover IPv6.
- Block rules **do not survive a restart** of the app, by design.
- Not yet implemented from resmon's feature set: TCP latency / packet loss per connection, associated handles and modules.
