import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DiskCard } from "@/components/cards/resourceCards";
import { MetricCard } from "@/components/cards/MetricCard";
import { Sparkline } from "@/components/cards/Sparkline";
import { DataTable } from "@/components/tables/DataTable";
import { UsageBar } from "@/components/tables/UsageBar";
import { ProcIcon } from "@/components/tables/ProcIcon";
import { Subtabs } from "@/components/layout/Subtabs";
import { COLORS, fmtBytes, heat } from "@/lib/format";
import { nameOrPid } from "@/lib/filters";
import type { DiskSnapshot, FileActivitySnapshot, ProcessSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

interface DiskRow extends DiskSnapshot {
  usedPct: number;
}

interface FileRow extends FileActivitySnapshot {
  io: number;
}

interface DiskProc extends ProcessSnapshot {
  io: number;
}

export function Disk({ snapshot: s, history }: ViewProps) {
  const [sub, setSub] = useState<"storage" | "files" | "proc">("storage");

  const read = s.processes.reduce((a, p) => a + p.read_bps, 0);
  const write = s.processes.reduce((a, p) => a + p.write_bps, 0);
  const busiest = s.disks.reduce((m, d) => Math.max(m, d.active_pct), 0);

  // per-column maxima for the heatmap
  const procMaxRead = Math.max(1, ...s.processes.map((p) => p.read_bps));
  const procMaxWrite = Math.max(1, ...s.processes.map((p) => p.write_bps));
  const fileMaxRead = Math.max(1, ...s.file_activity.map((f) => f.read_bps));
  const fileMaxWrite = Math.max(1, ...s.file_activity.map((f) => f.write_bps));

  // Storage rows enriched with used percentage.
  const storageRows = useMemo<DiskRow[]>(
    () =>
      s.disks.map((d) => ({
        ...d,
        usedPct: d.total ? ((d.total - d.available) / d.total) * 100 : 0,
      })),
    [s.disks],
  );

  // File activity pre-sorted by total I/O (computed, not a column).
  const fileRows = useMemo<FileRow[]>(
    () =>
      [...s.file_activity]
        .map((f) => ({ ...f, io: f.read_bps + f.write_bps }))
        .sort((a, b) => b.io - a.io),
    [s.file_activity],
  );

  // Processes with disk I/O, pre-sorted by total I/O (computed, not a column).
  const procRows = useMemo<DiskProc[]>(
    () =>
      s.processes
        .filter((p) => p.read_bps > 0 || p.write_bps > 0)
        .map((p) => ({ ...p, io: p.read_bps + p.write_bps }))
        .sort((a, b) => b.io - a.io),
    [s.processes],
  );

  const storageColumns = useMemo<ColumnDef<DiskRow, any>[]>(
    () => [
      {
        accessorKey: "mount",
        header: "Unidad",
        cell: ({ row }) =>
          `${row.original.mount} ${row.original.name}${row.original.removable ? " (extraíble)" : ""}`,
      },
      { accessorKey: "fs", header: "Sistema" },
      {
        accessorKey: "active_pct",
        header: "Activo",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => <UsageBar pct={row.original.active_pct} />,
      },
      {
        accessorKey: "queue",
        header: "Cola",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => row.original.queue.toFixed(2),
      },
      {
        accessorKey: "available",
        header: "Libre",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => fmtBytes(row.original.available),
      },
      {
        accessorKey: "total",
        header: "Total",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => fmtBytes(row.original.total),
      },
      {
        accessorKey: "usedPct",
        header: "Uso",
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => <UsageBar pct={row.original.usedPct} />,
      },
    ],
    [],
  );

  const fileColumns = useMemo<ColumnDef<FileRow, any>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Proceso",
        cell: ({ row }) => row.original.name,
      },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      {
        accessorKey: "file",
        header: "Archivo",
        meta: { path: true },
        cell: ({ row }) => <span title={row.original.file}>{row.original.file}</span>,
      },
      {
        accessorKey: "read_bps",
        header: "Lectura/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.read_bps / fileMaxRead) },
        cell: ({ row }) => fmtBytes(row.original.read_bps, "/s"),
      },
      {
        accessorKey: "write_bps",
        header: "Escritura/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.write_bps / fileMaxWrite) },
        cell: ({ row }) => fmtBytes(row.original.write_bps, "/s"),
      },
    ],
    [fileMaxRead, fileMaxWrite],
  );

  const procColumns = useMemo<ColumnDef<DiskProc, any>[]>(
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
        accessorKey: "read_bps",
        header: "Lectura/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.read_bps / procMaxRead) },
        cell: ({ row }) => fmtBytes(row.original.read_bps, "/s"),
      },
      {
        accessorKey: "write_bps",
        header: "Escritura/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.write_bps / procMaxWrite) },
        cell: ({ row }) => fmtBytes(row.original.write_bps, "/s"),
      },
    ],
    [procMaxRead, procMaxWrite],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">Resumen</h2>
        <div className="cards stacked">
          <DiskCard s={s} history={history} />
          <MetricCard title="Lectura total" value={fmtBytes(read, "/s")} detail="" accent={COLORS.disk}>
            <Sparkline
              values={history.read}
              max={Math.max(...history.read, 1024 * 512)}
              color={COLORS.disk}
            />
          </MetricCard>
          <MetricCard title="Escritura total" value={fmtBytes(write, "/s")} detail="" accent={COLORS.disk}>
            <Sparkline
              values={history.write}
              max={Math.max(...history.write, 1024 * 512)}
              color={COLORS.disk}
            />
          </MetricCard>
          <MetricCard
            title="Unidad más activa"
            value={`${busiest.toFixed(0)}%`}
            detail={`${s.disks.length} unidades`}
            accent={COLORS.disk}
          />
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">Detalle</h2>
        <Subtabs
          tabs={[
            { id: "storage", label: "Almacenamiento" },
            { id: "files", label: "Por archivo" },
            { id: "proc", label: "Procesos" },
          ]}
          active={sub}
          onChange={setSub}
        />
        {sub === "storage" && (
          <DataTable
            data={storageRows}
            columns={storageColumns}
            initialSorting={[{ id: "mount", desc: false }]}
            getRowId={(r) => r.mount}
          />
        )}
        {sub === "files" &&
          (!s.etw ? (
            <div className="notice">
              Ejecuta ResmonX como administrador para ver la actividad de disco por archivo.
            </div>
          ) : (
            <DataTable
              data={fileRows}
              columns={fileColumns}
              rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: "" })}
              getRowId={(r) => String(r.pid)}
            />
          ))}
        {sub === "proc" && (
          <DataTable
            data={procRows}
            columns={procColumns}
            filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
            rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: r.exe })}
            getRowId={(r) => String(r.pid)}
          />
        )}
      </div>
    </div>
  );
}
