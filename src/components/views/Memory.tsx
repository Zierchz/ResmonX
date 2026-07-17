import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MemCard } from "@/components/cards/resourceCards";
import { MetricCard } from "@/components/cards/MetricCard";
import { Donut } from "@/components/cards/Donut";
import { DataTable } from "@/components/tables/DataTable";
import { ProcIcon } from "@/components/tables/ProcIcon";
import { COLORS, fmtBytes, heat } from "@/lib/format";
import { nameOrPid } from "@/lib/filters";
import type { ProcessSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

export function Memory({ snapshot: s, history }: ViewProps) {
  const m = s.memory;
  // prefer live counters when present, else fall back to used/total split
  const counters = m.standby + m.modified + m.free > 0;
  const used = counters ? Math.max(m.total - m.standby - m.modified - m.free, 0) : m.used;
  const standby = counters ? m.standby : 0;
  const modified = counters ? m.modified : 0;
  const free = counters ? m.free : m.total - m.used;
  const usedPct = m.total > 0 ? (used / m.total) * 100 : 0;

  // warm oranges = in use; cool blues = available
  const segs = [
    { label: "En uso", value: used, color: "#e8843c" },
    { label: "Modificada", value: modified, color: "#b3632a" },
    { label: "En espera", value: standby, color: "#6d8db3" },
    { label: "Libre", value: free, color: "#33445a" },
  ];

  const maxMem = Math.max(1, ...s.processes.map((p) => p.memory));

  const columns = useMemo<ColumnDef<ProcessSnapshot, any>[]>(
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
      {
        accessorKey: "memory",
        header: "Memoria",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.memory / maxMem) },
        cell: ({ row }) => fmtBytes(row.original.memory),
      },
      {
        accessorKey: "virtual_memory",
        header: "Virtual",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => fmtBytes(row.original.virtual_memory),
      },
    ],
    [maxMem],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">Resumen</h2>
        <div className="cards stacked">
          <MemCard s={s} history={history} />
          <MetricCard
            title="En espera (caché)"
            value={fmtBytes(standby)}
            detail={`modificada ${fmtBytes(modified)}`}
            accent={COLORS.mem}
          />
        </div>
        <Donut segments={segs} total={m.total} centerPct={usedPct} centerCaption="en uso" />
      </aside>
      <div className="split-main">
        <h2 className="section-title first">Procesos</h2>
        <DataTable
          data={s.processes}
          columns={columns}
          initialSorting={[{ id: "memory", desc: true }]}
          filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
          rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: r.exe })}
          getRowId={(r) => String(r.pid)}
        />
      </div>
    </div>
  );
}
