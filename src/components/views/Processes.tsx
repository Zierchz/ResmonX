import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/DataTable";
import { ProcIcon } from "@/components/tables/ProcIcon";
import { fmtBytes, heat } from "@/lib/format";
import { nameOrPid } from "@/lib/filters";
import type { ProcessSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

export function Processes({ snapshot: s }: ViewProps) {
  // column maxima for the per-cell heatmap
  const maxMem = Math.max(1, ...s.processes.map((p) => p.memory));
  const maxRead = Math.max(1, ...s.processes.map((p) => p.read_bps));
  const maxWrite = Math.max(1, ...s.processes.map((p) => p.write_bps));

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
      { accessorKey: "threads", header: "Hilos", sortDescFirst: true, meta: { num: true } },
      {
        accessorKey: "cpu",
        header: "CPU %",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.cpu / 100) },
        cell: ({ row }) => row.original.cpu.toFixed(1),
      },
      {
        accessorKey: "memory",
        header: "RAM",
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
      {
        accessorKey: "read_bps",
        header: "Lectura/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.read_bps / maxRead) },
        cell: ({ row }) => fmtBytes(row.original.read_bps, "/s"),
      },
      {
        accessorKey: "write_bps",
        header: "Escritura/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.write_bps / maxWrite) },
        cell: ({ row }) => fmtBytes(row.original.write_bps, "/s"),
      },
    ],
    [maxMem, maxRead, maxWrite],
  );

  return (
    <DataTable
      data={s.processes}
      columns={columns}
      initialSorting={[{ id: "cpu", desc: true }]}
      filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
      rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: r.exe })}
      getRowId={(r) => String(r.pid)}
    />
  );
}
