import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MetricCard } from "@/components/cards/MetricCard";
import { Sparkline } from "@/components/cards/Sparkline";
import { DataTable } from "@/components/tables/DataTable";
import { COLORS, fmtBytes, heat } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { nameOrPid } from "@/lib/filters";
import type { GpuProcess } from "@/lib/types";
import type { ViewProps } from "./props";

export function Gpu({ snapshot: s, history }: ViewProps) {
  const { t } = useI18n();
  const g = s.gpu;
  const maxVram = Math.max(1, ...(g ? g.processes : []).map((p) => p.vram));

  // shared columns for both the present and no-GPU (empty) table
  const columns = useMemo<ColumnDef<GpuProcess, any>[]>(
    () => [
      { accessorKey: "name", header: t("col.process") },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "kind", header: t("col.kind") },
      {
        accessorKey: "vram",
        header: "VRAM",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.vram / maxVram) },
        cell: ({ row }) => fmtBytes(row.original.vram),
      },
    ],
    [maxVram, t],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">{t("sec.summary")}</h2>
        <div className="cards stacked">
          {g ? (
            <>
              <MetricCard
                title={t("col.usage")}
                value={`${g.utilization}%`}
                detail={g.name}
                accent={COLORS.gpu}
              >
                <Sparkline values={history.gpu} max={100} color={COLORS.gpu} />
              </MetricCard>
              <MetricCard
                title={t("card.clockCore")}
                value={`${g.clock_core} MHz`}
                detail={t("card.clockCore.detail", { v: g.clock_core_max, p: g.pstate })}
                accent={COLORS.gpu}
              />
              <MetricCard
                title={t("card.clockMem")}
                value={`${g.clock_mem} MHz`}
                detail={t("card.clockMem.detail", { v: g.clock_mem_max })}
                accent={COLORS.gpu}
              />
              <MetricCard
                title="VRAM"
                value={`${fmtBytes(g.mem_used)} / ${fmtBytes(g.mem_total)}`}
                detail=""
                accent={COLORS.gpu}
              />
              <MetricCard
                title={t("card.temp")}
                value={`${g.temp}°C`}
                detail={`${g.power_w.toFixed(1)} W`}
                accent={COLORS.gpu}
              />
            </>
          ) : (
            <MetricCard title="GPU" value={t("gpu.na")} detail={t("gpu.naDetail")} />
          )}
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">{t("sec.gpuProcs")}</h2>
        <DataTable
          data={g ? g.processes : []}
          columns={columns}
          initialSorting={[{ id: "vram", desc: true }]}
          filter={{ placeholder: t("filter.processes"), fn: nameOrPid }}
          rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: "" })}
          getRowId={(r) => String(r.pid)}
        />
      </div>
    </div>
  );
}
