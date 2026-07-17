import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CpuCard } from "@/components/cards/resourceCards";
import { MetricCard } from "@/components/cards/MetricCard";
import { CoreGrid } from "@/components/cards/CoreGrid";
import { DataTable } from "@/components/tables/DataTable";
import { ProcIcon } from "@/components/tables/ProcIcon";
import { ServiceBadge } from "@/components/tables/ServiceBadge";
import { Subtabs } from "@/components/layout/Subtabs";
import { COLORS, heat } from "@/lib/format";
import { nameOrPid, svcFilter } from "@/lib/filters";
import type { ProcessSnapshot, ServiceSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

// service row enriched with the owning process CPU
interface SvcRow extends ServiceSnapshot {
  cpu: number;
}

export function Cpu({ snapshot: s, history }: ViewProps) {
  const [sub, setSub] = useState<"proc" | "svc">("proc");

  const totalThreads = s.processes.reduce((a, p) => a + p.threads, 0);

  const svcRows = useMemo<SvcRow[]>(() => {
    const cpuByPid = new Map(s.processes.map((p) => [p.pid, p.cpu]));
    return s.services.map((v) => ({ ...v, cpu: v.pid ? (cpuByPid.get(v.pid) ?? 0) : 0 }));
  }, [s.services, s.processes]);

  const procColumns = useMemo<ColumnDef<ProcessSnapshot, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Proceso",
        cell: ({ row }) => (
          <span className="pname">
            <ProcIcon exe={row.original.exe} />
            {row.original.name}
          </span>
        ),
      },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "threads", header: "Hilos", sortDescFirst: true, meta: { num: true } },
      {
        accessorKey: "cpu",
        header: "CPU %",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.cpu / 100) },
        cell: ({ row }) => row.original.cpu.toFixed(1),
      },
    ],
    [],
  );

  const svcColumns = useMemo<ColumnDef<SvcRow, any>[]>(
    () => [
      { accessorKey: "name", header: "Servicio" },
      { accessorKey: "display", header: "Descripción" },
      {
        accessorKey: "pid",
        header: "PID",
        meta: { num: true },
        cell: ({ row }) => row.original.pid || "",
      },
      {
        accessorKey: "state",
        header: "Estado",
        cell: ({ row }) => <ServiceBadge state={row.original.state} />,
      },
      {
        accessorKey: "cpu",
        header: "CPU %",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => (row.original.pid ? row.original.cpu.toFixed(1) : ""),
      },
    ],
    [],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">Resumen</h2>
        <div className="cards stacked">
          <CpuCard s={s} history={history} />
          <MetricCard
            title="Frecuencia efectiva"
            value={`${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz`}
            detail={`base ${(s.cpu.base_mhz / 1000).toFixed(2)} GHz`}
            accent={COLORS.cpu}
          />
          <MetricCard
            title="Procesos"
            value={`${s.processes.length}`}
            detail={`${totalThreads} hilos · ${s.cpu.cores} núcleos lógicos`}
            accent={COLORS.cpu}
          />
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">Núcleos lógicos</h2>
        <CoreGrid perCore={s.cpu.per_core} />
        <Subtabs
          tabs={[
            { id: "proc", label: "Procesos" },
            { id: "svc", label: "Servicios" },
          ]}
          active={sub}
          onChange={setSub}
        />
        {sub === "proc" && (
          <DataTable
            data={s.processes}
            columns={procColumns}
            initialSorting={[{ id: "cpu", desc: true }]}
            filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
            rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: r.exe })}
            getRowId={(r) => String(r.pid)}
          />
        )}
        {sub === "svc" && (
          <DataTable
            data={svcRows}
            columns={svcColumns}
            initialSorting={[{ id: "name", desc: false }]}
            filter={{ placeholder: "Filtrar servicios…", fn: svcFilter }}
            getRowId={(r) => r.name}
          />
        )}
      </div>
    </div>
  );
}
