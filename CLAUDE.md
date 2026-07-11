# ResmonX — Project guide

Windows resource monitor. Tauri 2 (Rust backend + WebView2) with a vanilla TypeScript + Vite frontend, no UI framework. Windows-only.

## Commands

- `npm run tauri dev` — dev with hot reload (run terminal **as admin** to exercise ETW sections).
- `npm run tauri build` — release `.exe` + MSI + NSIS under `src-tauri/target/release/`.
- `npx tsc --noEmit` — typecheck the frontend.
- `cargo build` / `cargo check` — from `src-tauri/`. `cargo` is not on PATH in every shell; it lives at `~/.cargo/bin/cargo`.

## Architecture

- Backend exposes ONE polling command, `get_snapshot` (`monitor/mod.rs`), returning a single JSON `Snapshot` that aggregates every subsystem. The frontend polls it every 1.5 s (`POLL_MS`) and keeps a 120-sample ring buffer (`HISTORY_LEN`) for sparklines.
- Process actions are separate commands in `monitor/control.rs`: `kill_process`, `kill_process_tree`, `suspend_process`, `resume_process`. Register new commands in BOTH `control.rs` (as `#[tauri::command]`) and `lib.rs` `generate_handler!` using the full path `monitor::control::name` — a `pub use` re-export does NOT carry the command macros.
- One backend module per subsystem under `monitor/`: `cpufreq` (PDH), `pdh` (memory + per-disk counters), `gpu` (NVML), `net` (netstat2), `services` (SCM), `threads` (Toolhelp), `etw` (ETW session), `control` (actions).
- Frontend is one file (`src/main.ts`): interfaces mirror the Rust structs, one `render*` function per tab, canonical card builders (`cpuCard`, `memCard`, …) reused between Overview and each section, plus the context-menu / confirm-dialog / toast helpers.

## Conventions

- Rust structs are `#[derive(Serialize)]`; snake_case fields map 1:1 to the TS interfaces in `main.ts`. Change one, change the other.
- All table HTML is built with template strings and injected via `innerHTML`; user-controlled strings (process names, file paths) MUST go through `esc()` to prevent XSS.
- Color is information: per-resource accents via the `--card-accent` CSS var and `COLORS` map; usage bars carry a severity class (`sev-ok`/`sev-warn`/`sev-crit`) from `sevClass(pct)`. Numeric readouts use the mono font (`--font-mono`).
- Comments are short and direct.

## Windows / environment gotchas

- **ETW needs elevation.** `etw.rs` starts a `ferrisetw` user-trace session ("ResmonX-Trace"); without admin it fails and `EtwMonitor::available()` is false — the per-process-network and per-file-disk sections show a notice and everything else keeps working. It stops orphan sessions on startup and on `Drop`.
- **PDH handles** are typed structs in the `windows` crate (`PDH_HQUERY`/`PDH_HCOUNTER`), not `isize`. English counter names (`PdhAddEnglishCounterW`) so they work on localized Windows.
- The debug `.exe` is tied to the dev server (`devUrl` → localhost:1420); running it without `tauri dev` shows "can't reach this page". Only the **release** `.exe` embeds the frontend and runs standalone.
- GPU is NVIDIA-only (NVML); `GpuMonitor` degrades to `None` otherwise.
- The build machine needs the MSVC compiler component `VC.Tools.x86.x64` (the `VCTools` workload alone omits it — install with `--includeRecommended` or add the component explicitly).

## Git / workflow

- Before committing: propose the commit message (English, no body, no co-author) and the exact file list, then wait for approval.
- The GitHub integration token is read-only for the repo (can't create repos/releases). Pushes work via the git credential manager; releases must be published via the web UI or `gh`.
