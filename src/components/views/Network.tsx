import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { NetCard } from "@/components/cards/resourceCards";
import { MetricCard } from "@/components/cards/MetricCard";
import { Sparkline } from "@/components/cards/Sparkline";
import { DataTable } from "@/components/tables/DataTable";
import { Subtabs } from "@/components/layout/Subtabs";
import { COLORS, fmtBytes, heat } from "@/lib/format";
import { connFilter, nameOrPid } from "@/lib/filters";
import type { Connection, NetProcSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

// UDP has no state; TCP listeners report a LISTEN state.
const isListening = (c: Connection) =>
  c.protocol === "UDP" || c.state.toUpperCase().includes("LISTEN");

interface NetProcRow extends NetProcSnapshot {
  total: number;
}

export function Network({ snapshot: s, history }: ViewProps) {
  const [sub, setSub] = useState<"proc" | "conns" | "listen">("proc");

  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  const activeNics = s.nics.filter((n) => n.rx_bps > 0 || n.tx_bps > 0).length;

  // show active interfaces, or all when there are only a few
  const nics = useMemo(
    () => s.nics.filter((n) => n.rx_bps > 0 || n.tx_bps > 0 || s.nics.length <= 3),
    [s.nics],
  );

  const netData = useMemo<NetProcRow[]>(
    () => s.net_procs.map((p) => ({ ...p, total: p.sent_bps + p.recv_bps })),
    [s.net_procs],
  );
  const connsData = useMemo(() => s.connections.filter((c) => !isListening(c)), [s.connections]);
  const listenData = useMemo(() => s.connections.filter(isListening), [s.connections]);

  // per-column maxima for the heatmap
  const maxSent = Math.max(1, ...s.net_procs.map((p) => p.sent_bps));
  const maxRecv = Math.max(1, ...s.net_procs.map((p) => p.recv_bps));
  const maxTotal = Math.max(1, ...netData.map((p) => p.total));

  const netColumns = useMemo<ColumnDef<NetProcRow, any>[]>(
    () => [
      { accessorKey: "name", header: "Proceso" },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      {
        accessorKey: "sent_bps",
        header: "Enviado/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.sent_bps / maxSent) },
        cell: ({ row }) => fmtBytes(row.original.sent_bps, "/s"),
      },
      {
        accessorKey: "recv_bps",
        header: "Recibido/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.recv_bps / maxRecv) },
        cell: ({ row }) => fmtBytes(row.original.recv_bps, "/s"),
      },
      {
        accessorKey: "total",
        header: "Total/s",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.total / maxTotal) },
        cell: ({ row }) => fmtBytes(row.original.total, "/s"),
      },
    ],
    [maxSent, maxRecv, maxTotal],
  );

  const connColumns = useMemo<ColumnDef<Connection, any>[]>(
    () => [
      { accessorKey: "process", header: "Proceso" },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "protocol", header: "Proto" },
      { accessorKey: "local", header: "Local" },
      { accessorKey: "remote", header: "Remoto" },
      { accessorKey: "state", header: "Estado" },
    ],
    [],
  );

  const listenColumns = useMemo<ColumnDef<Connection, any>[]>(
    () => [
      { accessorKey: "process", header: "Proceso" },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "protocol", header: "Proto" },
      { accessorKey: "local", header: "Dirección local" },
    ],
    [],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">Resumen</h2>
        <div className="cards stacked">
          <NetCard s={s} history={history} />
          <MetricCard
            title="Subida"
            value={fmtBytes(tx, "/s")}
            detail={`${activeNics} interfaces activas`}
            accent={COLORS.net}
          >
            <Sparkline values={history.tx} max={Math.max(...history.tx, 1024 * 128)} color={COLORS.net} />
          </MetricCard>
          <MetricCard
            title="Conexiones"
            value={`${s.connections.length}`}
            detail="TCP/UDP activas y en escucha"
            accent={COLORS.net}
          />
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">Por interfaz</h2>
        <div className="cards">
          {nics.map((n) => (
            <MetricCard
              key={n.name}
              title={n.name}
              value={`↓ ${fmtBytes(n.rx_bps, "/s")}`}
              detail={`↑ ${fmtBytes(n.tx_bps, "/s")}`}
              accent={COLORS.net}
            />
          ))}
        </div>
        <Subtabs
          tabs={[
            { id: "proc", label: "Procesos" },
            { id: "conns", label: "Conexiones" },
            { id: "listen", label: "Escucha" },
          ]}
          active={sub}
          onChange={setSub}
        />
        {sub === "proc" &&
          (!s.etw ? (
            <div className="notice">
              Ejecuta ResmonX como administrador para ver la actividad de red por proceso.
            </div>
          ) : (
            <DataTable
              data={netData}
              columns={netColumns}
              initialSorting={[{ id: "total", desc: true }]}
              filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
              rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: "" })}
              getRowId={(r) => String(r.pid)}
            />
          ))}
        {sub === "conns" && (
          <DataTable
            data={connsData}
            columns={connColumns}
            initialSorting={[{ id: "process", desc: false }]}
            filter={{ placeholder: "Filtrar conexiones…", fn: connFilter }}
          />
        )}
        {sub === "listen" && (
          <DataTable
            data={listenData}
            columns={listenColumns}
            initialSorting={[{ id: "process", desc: false }]}
          />
        )}
      </div>
    </div>
  );
}
