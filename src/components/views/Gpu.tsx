import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MetricCard } from "@/components/cards/MetricCard";
import { Sparkline } from "@/components/cards/Sparkline";
import { DataTable } from "@/components/tables/DataTable";
import { COLORS, fmtBytes, heat } from "@/lib/format";
import { nameOrPid } from "@/lib/filters";
import type { GpuProcess } from "@/lib/types";
import type { ViewProps } from "./props";

export function Gpu({ snapshot: s, history }: ViewProps) {
  const g = s.gpu;
  const maxVram = Math.max(1, ...(g ? g.processes : []).map((p) => p.vram));

  // shared columns for both the present and no-GPU (empty) table
  const columns = useMemo<ColumnDef<GpuProcess, any>[]>(
    () => [
      { accessorKey: "name", header: "Proceso" },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "kind", header: "Tipo" },
      {
        accessorKey: "vram",
        header: "VRAM",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.vram / maxVram) },
        cell: ({ row }) => fmtBytes(row.original.vram),
      },
    ],
    [maxVram],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">Resumen</h2>
        <div className="cards stacked">
          {g ? (
            <>
              <MetricCard title="Uso" value={`${g.utilization}%`} detail={g.name} accent={COLORS.gpu}>
                <Sparkline values={history.gpu} max={100} color={COLORS.gpu} />
              </MetricCard>
              <MetricCard
                title="Reloj núcleo"
                value={`${g.clock_core} MHz`}
                detail={`máx ${g.clock_core_max} MHz · estado ${g.pstate}`}
                accent={COLORS.gpu}
              />
              <MetricCard
                title="Reloj memoria"
                value={`${g.clock_mem} MHz`}
                detail={`máx ${g.clock_mem_max} MHz`}
                accent={COLORS.gpu}
              />
              <MetricCard
                title="VRAM"
                value={`${fmtBytes(g.mem_used)} / ${fmtBytes(g.mem_total)}`}
                detail=""
                accent={COLORS.gpu}
              />
              <MetricCard
                title="Temperatura"
                value={`${g.temp}°C`}
                detail={`${g.power_w.toFixed(1)} W`}
                accent={COLORS.gpu}
              />
            </>
          ) : (
            <MetricCard
              title="GPU"
              value="No disponible"
              detail="No se detectó GPU NVIDIA (NVML)"
            />
          )}
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">Procesos en la GPU</h2>
        <DataTable
          data={g ? g.processes : []}
          columns={columns}
          initialSorting={[{ id: "vram", desc: true }]}
          filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
          rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: "" })}
          getRowId={(r) => String(r.pid)}
        />
      </div>
    </div>
  );
}
