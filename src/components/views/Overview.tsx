import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CpuCard, DiskCard, GpuCard, MemCard, NetCard } from "@/components/cards/resourceCards";
import { DataTable } from "@/components/tables/DataTable";
import { ProcIcon } from "@/components/tables/ProcIcon";
import { ServiceBadge } from "@/components/tables/ServiceBadge";
import { Subtabs } from "@/components/layout/Subtabs";
import { fmtBytes, heat } from "@/lib/format";
import { nameOrPid } from "@/lib/filters";
import type { ProcessSnapshot, ServiceSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

interface OvProc extends ProcessSnapshot {
  io: number;
  net: number;
}

export function Overview({ snapshot: s, history }: ViewProps) {
  const [sub, setSub] = useState<"proc" | "svc">("proc");

  const netByPid = useMemo(
    () => new Map(s.net_procs.map((p) => [p.pid, p.sent_bps + p.recv_bps])),
    [s.net_procs],
  );
  const rows = useMemo<OvProc[]>(
    () =>
      s.processes.map((p) => ({
        ...p,
        io: p.read_bps + p.write_bps,
        net: netByPid.get(p.pid) ?? 0,
      })),
    [s.processes, netByPid],
  );

  const maxMem = Math.max(1, ...rows.map((p) => p.memory));
  const maxDisk = Math.max(1, ...rows.map((p) => p.io));
  const maxNet = Math.max(1, ...rows.map((p) => p.net));
  const etw = s.etw;

  const procColumns = useMemo<ColumnDef<OvProc, any>[]>(
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
        accessorKey: "io",
        header: "Disco/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.io / maxDisk) },
        cell: ({ row }) => fmtBytes(row.original.io, "/s"),
      },
      {
        accessorKey: "net",
        header: "Red/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => (etw ? heat(r.net / maxNet) : undefined) },
        cell: ({ row }) => (etw ? fmtBytes(row.original.net, "/s") : "—"),
      },
      { accessorKey: "threads", header: "Hilos", sortDescFirst: true, meta: { num: true } },
    ],
    [etw, maxMem, maxDisk, maxNet],
  );

  const svcColumns = useMemo<ColumnDef<ServiceSnapshot, any>[]>(
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
    ],
    [],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">Resumen</h2>
        <div className="cards stacked">
          <CpuCard s={s} history={history} />
          <MemCard s={s} history={history} />
          <NetCard s={s} history={history} />
          <DiskCard s={s} history={history} />
          {s.gpu && <GpuCard s={s} history={history} />}
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">Detalle</h2>
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
            data={rows}
            columns={procColumns}
            initialSorting={[{ id: "cpu", desc: true }]}
            filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
            rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: r.exe })}
            getRowId={(r) => String(r.pid)}
          />
        )}
        {sub === "svc" && (
          <DataTable
            data={s.services}
            columns={svcColumns}
            initialSorting={[{ id: "name", desc: false }]}
            getRowId={(r) => r.name}
          />
        )}
      </div>
    </div>
  );
}
