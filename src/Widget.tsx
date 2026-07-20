import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { Sparkline } from "@/components/cards/Sparkline";
import { DataTable } from "@/components/tables/DataTable";
import { useSnapshot } from "@/hooks/useSnapshot";
import { nameOrPid } from "@/lib/filters";
import { ACCENT, fmtBytes, heat } from "@/lib/format";
import type { TabId } from "@/lib/tabs";
import { openMainTab } from "@/lib/tauri";
import type { ProcessSnapshot } from "@/lib/types";

const OPACITY_KEY = "resmonx.widget.opacity";
const POS_KEY = "resmonx.widget.pos";

interface WProc extends ProcessSnapshot {
  net: number;
}

// Compressed live metrics (mini-cards) plus the sortable, filterable process table.
export function Widget() {
  const { snapshot: s, history } = useSnapshot();
  const [opacity, setOpacity] = useState(() => {
    const v = Number(localStorage.getItem(OPACITY_KEY));
    return v >= 0.4 && v <= 1 ? v : 1;
  });

  // restore saved position, then persist on every move
  useEffect(() => {
    const win = getCurrentWindow();
    const saved = localStorage.getItem(POS_KEY);
    if (saved) {
      try {
        const { x, y } = JSON.parse(saved);
        void win.setPosition(new PhysicalPosition(x, y));
      } catch {
        // ignore corrupt value
      }
    }
    const un = win.onMoved(({ payload }) => {
      localStorage.setItem(POS_KEY, JSON.stringify({ x: payload.x, y: payload.y }));
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const setOp = (v: number) => {
    setOpacity(v);
    localStorage.setItem(OPACITY_KEY, String(v));
  };

  const etw = s?.etw ?? false;
  const netByPid = useMemo(
    () => new Map((s?.net_procs ?? []).map((p) => [p.pid, p.sent_bps + p.recv_bps])),
    [s?.net_procs],
  );
  const rows = useMemo<WProc[]>(
    () => (s ? s.processes.map((p) => ({ ...p, net: netByPid.get(p.pid) ?? 0 })) : []),
    [s?.processes, netByPid],
  );
  const maxMem = Math.max(1, ...rows.map((r) => r.memory));
  const maxNet = Math.max(1, ...rows.map((r) => r.net));

  const columns = useMemo<ColumnDef<WProc, any>[]>(
    () => [
      { accessorKey: "name", header: "Proceso", meta: { path: true } },
      {
        accessorKey: "cpu",
        header: "CPU",
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
        accessorKey: "net",
        header: "Red",
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => (etw ? heat(r.net / maxNet) : undefined) },
        cell: ({ row }) => (etw ? fmtBytes(row.original.net, "/s") : "—"),
      },
    ],
    [etw, maxMem, maxNet],
  );

  const cpu = s?.cpu.usage ?? 0;
  const mem = s ? (s.memory.used / s.memory.total) * 100 : 0;
  const gpu = s?.gpu?.utilization ?? 0;
  const rx = s ? s.nics.reduce((a, n) => a + n.rx_bps, 0) : 0;
  const tx = s ? s.nics.reduce((a, n) => a + n.tx_bps, 0) : 0;
  const read = s ? s.processes.reduce((a, p) => a + p.read_bps, 0) : 0;
  const write = s ? s.processes.reduce((a, p) => a + p.write_bps, 0) : 0;

  return (
    <div className="widget" style={{ opacity }}>
      <div className="whead" data-tauri-drag-region>
        <span className="wtitle" data-tauri-drag-region>
          ResmonX
        </span>
        <input
          className="wopacity"
          type="range"
          min={40}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOp(Number(e.target.value) / 100)}
          title="Opacidad"
        />
        <button className="wclose" onClick={() => void getCurrentWindow().hide()} title="Ocultar">
          ✕
        </button>
      </div>

      {s && (
        <>
          <div className="wtiles">
            <Tile tab="cpu" title="CPU" value={`${cpu.toFixed(0)}%`} values={history.cpu} max={100} />
            <Tile tab="memory" title="RAM" value={`${mem.toFixed(0)}%`} values={history.mem} max={100} />
            {s.gpu && (
              <Tile tab="gpu" title="GPU" value={`${gpu.toFixed(0)}%`} values={history.gpu} max={100} />
            )}
            <Tile
              tab="disk"
              title="Disco"
              value={fmtBytes(read + write, "/s")}
              values={history.write}
              max={Math.max(...history.write, 1024 * 512)}
            />
            <Tile
              tab="network"
              title="Red"
              value={fmtBytes(rx + tx, "/s")}
              values={history.rx}
              max={Math.max(...history.rx, 1024 * 128)}
            />
          </div>

          <button className="wproc-title" onClick={() => void openMainTab("processes")}>
            Procesos
          </button>
          <div className="wproc-area">
            <DataTable
              data={rows}
              columns={columns}
              initialSorting={[{ id: "cpu", desc: true }]}
              filter={{ placeholder: "Filtrar procesos…", fn: nameOrPid }}
              getRowId={(r) => String(r.pid)}
            />
          </div>
        </>
      )}
    </div>
  );
}

// One compressed metric: title + value on a line, mini sparkline below.
function Tile({
  tab,
  title,
  value,
  values,
  max,
}: {
  tab: TabId;
  title: string;
  value: string;
  values: number[];
  max: number;
}) {
  return (
    <button className="wtile" onClick={() => void openMainTab(tab)} title="Abrir en ResmonX">
      <div className="wtile-head">
        <span className="wtile-title">{title}</span>
        <span className="wtile-val mono">{value}</span>
      </div>
      <div className="wtile-spark">
        <Sparkline values={values} max={max} color={ACCENT} />
      </div>
    </button>
  );
}
