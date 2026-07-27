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
import { useI18n } from "@/lib/i18n";
import { nameOrPid, svcFilter } from "@/lib/filters";
import type { ProcessSnapshot, ServiceSnapshot } from "@/lib/types";
import type { ViewProps } from "./props";

// service row enriched with the owning process CPU
interface SvcRow extends ServiceSnapshot {
  cpu: number;
}

export function Cpu({ snapshot: s, history }: ViewProps) {
  const { t } = useI18n();
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
        header: t("col.process"),
        cell: ({ row }) => (
          <span className="pname">
            <ProcIcon exe={row.original.exe} />
            {row.original.name}
          </span>
        ),
      },
      { accessorKey: "pid", header: "PID", sortDescFirst: true, meta: { num: true } },
      { accessorKey: "threads", header: t("col.threads"), sortDescFirst: true, meta: { num: true } },
      {
        accessorKey: "cpu",
        header: t("col.cpuPct"),
        sortDescFirst: true,
        meta: { num: true, cellStyle: (r) => heat(r.cpu / 100) },
        cell: ({ row }) => row.original.cpu.toFixed(1),
      },
    ],
    [t],
  );

  const svcColumns = useMemo<ColumnDef<SvcRow, any>[]>(
    () => [
      { accessorKey: "name", header: t("col.service") },
      { accessorKey: "display", header: t("col.description") },
      {
        accessorKey: "pid",
        header: "PID",
        meta: { num: true },
        cell: ({ row }) => row.original.pid || "",
      },
      {
        accessorKey: "state",
        header: t("col.state"),
        cell: ({ row }) => <ServiceBadge state={row.original.state} />,
      },
      {
        accessorKey: "cpu",
        header: t("col.cpuPct"),
        sortDescFirst: true,
        meta: { num: true },
        cell: ({ row }) => (row.original.pid ? row.original.cpu.toFixed(1) : ""),
      },
    ],
    [t],
  );

  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">{t("sec.summary")}</h2>
        <div className="cards stacked">
          <CpuCard s={s} history={history} />
          <MetricCard
            title={t("card.freq.title")}
            value={`${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz`}
            detail={t("card.freq.detail", { ghz: (s.cpu.base_mhz / 1000).toFixed(2) })}
            accent={COLORS.cpu}
          />
          <MetricCard
            title={t("tab.processes")}
            value={`${s.processes.length}`}
            detail={t("card.procs.detail", { threads: totalThreads, cores: s.cpu.cores })}
            accent={COLORS.cpu}
          />
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">{t("sec.cores")}</h2>
        <CoreGrid perCore={s.cpu.per_core} />
        <Subtabs
          tabs={[
            { id: "proc", label: t("sub.processes") },
            { id: "svc", label: t("sub.services") },
          ]}
          active={sub}
          onChange={setSub}
        />
        {sub === "proc" && (
          <DataTable
            data={s.processes}
            columns={procColumns}
            initialSorting={[{ id: "cpu", desc: true }]}
            filter={{ placeholder: t("filter.processes"), fn: nameOrPid }}
            rowTarget={(r) => ({ pid: r.pid, name: r.name, exe: r.exe })}
            getRowId={(r) => String(r.pid)}
          />
        )}
        {sub === "svc" && (
          <DataTable
            data={svcRows}
            columns={svcColumns}
            initialSorting={[{ id: "name", desc: false }]}
            filter={{ placeholder: t("filter.services"), fn: svcFilter }}
            getRowId={(r) => r.name}
          />
        )}
      </div>
    </div>
  );
}
