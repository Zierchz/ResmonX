# ResmonX

Monitor de recursos para Windows con interfaz moderna. Alternativa a `resmon` / Administrador de tareas.

## Qué muestra

- **Resumen**: CPU (uso y frecuencia efectiva vía PDH), memoria, red, disco y GPU con histórico.
- **Procesos**: tabla ordenable con CPU %, RAM e I/O de disco por proceso.
- **Red**: tráfico por interfaz y tabla de conexiones TCP/UDP con proceso propietario.
- **Disco**: I/O por proceso (lectura/escritura por segundo).
- **GPU**: relojes, VRAM, temperatura, potencia, estado P y procesos que usan la GPU (NVML, solo NVIDIA).

## Stack

- [Tauri 2](https://tauri.app) — backend Rust + WebView2.
- Backend: `sysinfo` (CPU/RAM/procesos/red), `netstat2` (conexiones), `nvml-wrapper` (GPU), PDH vía `windows` (frecuencia efectiva de CPU).
- Frontend: TypeScript vanilla + Vite, sin frameworks.

## Desarrollo

Requisitos: Rust (MSVC), Node, VS Build Tools con Windows SDK.

```sh
npm install
npm run tauri dev
```

Build de producción:

```sh
npm run tauri build
```

## Pendiente

- I/O de disco por archivo (requiere ETW y ejecutar como administrador).
- Tráfico de red por proceso (también ETW).
