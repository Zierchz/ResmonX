import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { NetCard } from "@/components/cards/resourceCards";
import { MetricCard } from "@/components/cards/MetricCard";
import { Sparkline } from "@/components/cards/Sparkline";
import { DataTable } from "@/components/tables/DataTable";
import { Subtabs } from "@/components/layout/Subtabs";
import { Button } from "@/components/ui/button";
import { COLORS, fmtBytes, heat } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { connFilter, nameOrPid } from "@/lib/filters";
import { removeFirewallRule } from "@/lib/tauri";
import type { Connection, FirewallRule, NetProcSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

// UDP has no state; TCP listeners report a LISTEN state.
const isListening = (c: Connection) =>
  c.protocol === "UDP" || c.state.toUpperCase().includes("LISTEN");

interface NetProcRow extends NetProcSnapshot {
  total: number;
}

export function Network({ snapshot: s, history }: ViewProps) {
  const { t } = useI18n();
  const [sub, setSub] = useState<"proc" | "conns" | "listen" | "rules">("proc");

  const tx = s.nics.reduce((a, n) => a + n.tx_bps, 0);
  const activeNics = s.nics.filter((n) => n.rx_bps > 0 || n.tx_bps > 0).length;

  // show active interfaces, or all when there are only a few
  const nics = useMemo(
    () => s.nics.filter((n) => n.rx_bps > 0 || n.tx_bps > 0 || s.nics.length <= 3),
    [s.nics],
  );

  // Every process, not just the ones with traffic right now: ETW only reports a
  // process while it moves bytes, so filtering by that made rows appear and
  // vanish on each tick and the table jump around. Idle processes read 0.
  const netByPid = useMemo(() => new Map(s.net_procs.map((p) => [p.pid, p])), [s.net_procs]);
  const netData = useMemo<NetProcRow[]>(
    () =>
      s.processes
        .map((p) => {
          const n = netByPid.get(p.pid);
          const sent_bps = n?.sent_bps ?? 0;
          const recv_bps = n?.recv_bps ?? 0;
          return { pid: p.pid, name: p.name, sent_bps, recv_bps, total: sent_bps + recv_bps };
        })
        // Alphabetical so ties resolve the same way every tick: sorting is
        // stable, and the backend's CPU order would reshuffle the idle rows.
        .sort((a, b) => a.name.localeCompare(b.name)),
    [s.processes, netByPid],
  );
  const connsData = useMemo(() => s.connections.filter((c) => !isListening(c)), [s.connections]);
  const listenData = useMemo(() => s.connections.filter(isListening), [s.connections]);

  // connection and ETW rows only carry a PID; the exe path comes from the
  // process list and is what the firewall rules and "open location" need
  const exeByPid = useMemo(
    () => new Map(s.processes.map((p) => [p.pid, p.exe])),
    [s.processes],
  );

  // per-column maxima for the heatmap
  const maxSent = Math.max(1, ...s.net_procs.map((p) => p.sent_bps));
  const maxRecv = Math.max(1, ...s.net_procs.map((p) => p.recv_bps));
  const maxTotal = Math.max(1, ...netData.map((p) => p.total));

  const netColumns = useMemo<ColumnDef<NetProcRow, any>[]>(
    () => [
      { accessorKey: "name", header: t("col.process") },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      {
        accessorKey: "sent_bps",
        header: t("col.sentPs"),
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.sent_bps / maxSent) },
        cell: ({ row }) => fmtBytes(row.original.sent_bps, "/s"),
      },
      {
        accessorKey: "recv_bps",
        header: t("col.recvPs"),
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.recv_bps / maxRecv) },
        cell: ({ row }) => fmtBytes(row.original.recv_bps, "/s"),
      },
      {
        accessorKey: "total",
        header: t("col.totalPs"),
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.total / maxTotal) },
        cell: ({ row }) => fmtBytes(row.original.total, "/s"),
      },
    ],
    [maxSent, maxRecv, maxTotal, t],
  );

  const connColumns = useMemo<ColumnDef<Connection, any>[]>(
    () => [
      { accessorKey: "process", header: t("col.process") },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "protocol", header: "Proto" },
      { accessorKey: "local", header: "Local" },
      { accessorKey: "remote", header: t("col.remote") },
      { accessorKey: "state", header: t("col.state") },
    ],
    [t],
  );

  const listenColumns = useMemo<ColumnDef<Connection, any>[]>(
    () => [
      { accessorKey: "process", header: t("col.process") },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "protocol", header: "Proto" },
      { accessorKey: "local", header: t("col.localAddr") },
    ],
    [t],
  );

  const unblock = async (rule: FirewallRule) => {
    try {
      await removeFirewallRule(rule.id);
      toast.success(t("toast.unblocked", { name: rule.label }));
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  const ruleColumns = useMemo<ColumnDef<FirewallRule, any>[]>(
    () => [
      {
        accessorKey: "kind",
        header: t("col.kind"),
        cell: ({ row }) =>
          t(row.original.kind === "process" ? "fw.kindProcess" : "fw.kindIp"),
      },
      { accessorKey: "label", header: t("col.blocked") },
      { accessorKey: "target", header: t("col.match"), meta: { path: true } },
      {
        id: "unblock",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Button variant="outline" size="xs" onClick={() => void unblock(row.original)}>
            {t("fw.unblock")}
          </Button>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">{t("sec.summary")}</h2>
        <div className="cards stacked">
          <NetCard s={s} history={history} />
          <MetricCard
            title={t("card.upload")}
            value={fmtBytes(tx, "/s")}
            detail={t("card.upload.detail", { n: activeNics })}
            accent={COLORS.net}
          >
            <Sparkline values={history.tx} max={Math.max(...history.tx, 1024 * 128)} color={COLORS.net} />
          </MetricCard>
          <MetricCard
            title={t("sub.connections")}
            value={`${s.connections.length}`}
            detail={t("card.conns.detail")}
            accent={COLORS.net}
          />
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">{t("sec.perNic")}</h2>
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
            { id: "proc", label: t("sub.processes") },
            { id: "conns", label: t("sub.connections") },
            { id: "listen", label: t("sub.listening") },
            { id: "rules", label: t("sub.rules") },
          ]}
          active={sub}
          onChange={setSub}
        />
        {sub === "proc" &&
          (!s.etw ? (
            <div className="notice">{t("notice.etwNet")}</div>
          ) : (
            <DataTable
              data={netData}
              columns={netColumns}
              initialSorting={[{ id: "total", desc: true }]}
              filter={{ placeholder: t("filter.processes"), fn: nameOrPid }}
              rowTarget={(r) => ({
                pid: r.pid,
                name: r.name,
                exe: exeByPid.get(r.pid) ?? "",
              })}
              getRowId={(r) => String(r.pid)}
            />
          ))}
        {sub === "conns" && (
          <DataTable
            data={connsData}
            columns={connColumns}
            initialSorting={[{ id: "process", desc: false }]}
            filter={{ placeholder: t("filter.connections"), fn: connFilter }}
            rowTarget={(r) => ({
              pid: r.pid,
              name: r.process,
              exe: exeByPid.get(r.pid) ?? "",
              conn: { protocol: r.protocol, local: r.local, remote: r.remote },
            })}
          />
        )}
        {/* listeners have no remote peer and no TCB to close: process actions only */}
        {sub === "listen" && (
          <DataTable
            data={listenData}
            columns={listenColumns}
            initialSorting={[{ id: "process", desc: false }]}
            rowTarget={(r) => ({
              pid: r.pid,
              name: r.process,
              exe: exeByPid.get(r.pid) ?? "",
            })}
          />
        )}
        {sub === "rules" &&
          (s.firewall_rules.length === 0 ? (
            <div className="notice">{t("notice.noRules")}</div>
          ) : (
            <DataTable
              data={s.firewall_rules}
              columns={ruleColumns}
              getRowId={(r) => String(r.id)}
            />
          ))}
      </div>
    </div>
  );
}
