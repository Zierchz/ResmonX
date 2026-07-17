import { MetricCard } from "./MetricCard";
import { Sparkline } from "./Sparkline";
import { COLORS, fmtBytes } from "@/lib/format";
import type { History, Snapshot } from "@/lib/types";

// Canonical cards, identical in Overview and each section.

export function CpuCard({ s, history }: { s: Snapshot; history: History }) {
  return (
    <MetricCard
      title="CPU"
      value={`${s.cpu.usage.toFixed(1)}%`}
      detail={`${s.cpu.name} · ${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz efectivos · ${s.cpu.cores} núcleos`}
      accent={COLORS.cpu}
    >
      <Sparkline values={history.cpu} max={100} color={COLORS.cpu} />
    </MetricCard>
  );
}

export function MemCard({ s, history }: { s: Snapshot; history: History }) {
  return (
    <MetricCard
      title="Memoria"
      value={`${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`}
      detail={`${((s.memory.used / s.memory.total) * 100).toFixed(1)}% · swap ${fmtBytes(s.memory.swap_used)}`}
      accent={COLORS.mem}
    >
      <Sparkline values={history.mem} max={100} color={COLORS.mem} />
    </MetricCard>
  );
}

export function NetCard({ s, history }: { s: Snapshot; history: History }) {
  const rx = s.nics.reduce((a, n) => a + n.rx_bps, 0);
  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  return (
    <MetricCard
      title="Red"
      value={`↓ ${fmtBytes(rx, "/s")} · ↑ ${fmtBytes(tx, "/s")}`}
      detail={`${s.connections.length} conexiones activas`}
      accent={COLORS.net}
    >
      <Sparkline values={history.rx} max={Math.max(...history.rx, 1024 * 128)} color={COLORS.net} />
    </MetricCard>
  );
}

export function DiskCard({ s, history }: { s: Snapshot; history: History }) {
  const read = s.processes.reduce((a, p) => a + p.read_bps, 0);
  const write = s.processes.reduce((a, p) => a + p.write_bps, 0);
  return (
    <MetricCard
      title="Disco"
      value={`R ${fmtBytes(read, "/s")} · W ${fmtBytes(write, "/s")}`}
      detail="I/O agregado por procesos"
      accent={COLORS.disk}
    >
      <Sparkline
        values={history.write}
        max={Math.max(...history.write, 1024 * 512)}
        color={COLORS.disk}
      />
    </MetricCard>
  );
}

export function GpuCard({ s, history }: { s: Snapshot; history: History }) {
  if (!s.gpu) return null;
  const g = s.gpu;
  return (
    <MetricCard
      title="GPU"
      value={`${g.utilization}% · ${g.clock_core} MHz`}
      detail={`${g.name} · ${fmtBytes(g.mem_used)} VRAM · ${g.temp}°C · ${g.power_w.toFixed(1)} W · ${g.pstate}`}
      accent={COLORS.gpu}
    >
      <Sparkline values={history.gpu} max={100} color={COLORS.gpu} />
    </MetricCard>
  );
}
