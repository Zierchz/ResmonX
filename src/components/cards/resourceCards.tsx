import { MetricCard } from "./MetricCard";
import { Sparkline } from "./Sparkline";
import { COLORS, fmtBytes } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { History, Snapshot } from "@/lib/types";

// Canonical cards, identical in Overview and each section.

export function CpuCard({ s, history }: { s: Snapshot; history: History }) {
  const { t } = useI18n();
  return (
    <MetricCard
      title={t("tab.cpu")}
      value={`${s.cpu.usage.toFixed(1)}%`}
      detail={t("card.cpu.detail", {
        name: s.cpu.name,
        ghz: (s.cpu.freq_mhz / 1000).toFixed(2),
        cores: s.cpu.cores,
      })}
      accent={COLORS.cpu}
    >
      <Sparkline values={history.cpu} max={100} color={COLORS.cpu} />
    </MetricCard>
  );
}

export function MemCard({ s, history }: { s: Snapshot; history: History }) {
  const { t } = useI18n();
  return (
    <MetricCard
      title={t("tab.memory")}
      value={`${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`}
      detail={t("card.mem.detail", {
        pct: ((s.memory.used / s.memory.total) * 100).toFixed(1),
        swap: fmtBytes(s.memory.swap_used),
      })}
      accent={COLORS.mem}
    >
      <Sparkline values={history.mem} max={100} color={COLORS.mem} />
    </MetricCard>
  );
}

export function NetCard({ s, history }: { s: Snapshot; history: History }) {
  const { t } = useI18n();
  const rx = s.nics.reduce((a, n) => a + n.rx_bps, 0);
  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  return (
    <MetricCard
      title={t("tab.network")}
      value={`↓ ${fmtBytes(rx, "/s")} · ↑ ${fmtBytes(tx, "/s")}`}
      detail={t("card.net.detail", { n: s.connections.length })}
      accent={COLORS.net}
    >
      <Sparkline values={history.rx} max={Math.max(...history.rx, 1024 * 128)} color={COLORS.net} />
    </MetricCard>
  );
}

export function DiskCard({ s, history }: { s: Snapshot; history: History }) {
  const { t } = useI18n();
  const read = s.processes.reduce((a, p) => a + p.read_bps, 0);
  const write = s.processes.reduce((a, p) => a + p.write_bps, 0);
  return (
    <MetricCard
      title={t("tab.disk")}
      value={`R ${fmtBytes(read, "/s")} · W ${fmtBytes(write, "/s")}`}
      detail={t("card.disk.detail")}
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
  const { t } = useI18n();
  if (!s.gpu) return null;
  const g = s.gpu;
  return (
    <MetricCard
      title={t("tab.gpu")}
      value={`${g.utilization}% · ${g.clock_core} MHz`}
      detail={`${g.name} · ${fmtBytes(g.mem_used)} VRAM · ${g.temp}°C · ${g.power_w.toFixed(1)} W · ${g.pstate}`}
      accent={COLORS.gpu}
    >
      <Sparkline values={history.gpu} max={100} color={COLORS.gpu} />
    </MetricCard>
  );
}
