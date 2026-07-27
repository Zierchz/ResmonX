import { useEffect, useRef, useState } from "react";
import { BellIcon, BellOffIcon } from "lucide-react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtBytes } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  loadAlertSettings,
  newTracker,
  saveAlertSettings,
  track,
  type AlertRule,
  type AlertSettings,
} from "@/lib/alerts";
import type { DiskSnapshot, ProcessSnapshot, Snapshot } from "@/lib/types";

async function notify(title: string, body: string) {
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  if (ok) sendNotification({ title, body });
}

function topBy(procs: ProcessSnapshot[], value: (p: ProcessSnapshot) => number) {
  let best: ProcessSnapshot | null = null;
  for (const p of procs) if (!best || value(p) > value(best)) best = p;
  return best;
}

function Row({
  label,
  rule,
  onChange,
}: {
  label: string;
  rule: AlertRule;
  onChange: (r: AlertRule) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex flex-1 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-(--primary)"
          checked={rule.enabled}
          onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
        />
        {label}
      </label>
      <Input
        type="number"
        min={50}
        max={100}
        disabled={!rule.enabled}
        value={rule.threshold}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (!Number.isNaN(v)) onChange({ ...rule, threshold: v });
        }}
        onBlur={() => onChange({ ...rule, threshold: Math.min(100, Math.max(50, rule.threshold)) })}
        className="h-7 w-16 px-2 text-right font-mono text-xs"
      />
      <span className="text-xs text-muted-foreground">%</span>
    </div>
  );
}

// Bell in the topbar: threshold settings popover + the detection loop that
// fires native Windows notifications on sustained high usage.
export function AlertsButton({ snapshot: s }: { snapshot: Snapshot | null }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AlertSettings>(loadAlertSettings);
  const trackers = useRef({ cpu: newTracker(), mem: newTracker(), disk: newTracker() });

  const update = (next: AlertSettings) => {
    setSettings(next);
    saveAlertSettings(next);
  };

  useEffect(() => {
    if (!s) return;
    const now = Date.now();
    const tr = trackers.current;

    if (track(tr.cpu, s.cpu.usage, settings.cpu, now)) {
      const top = topBy(s.processes, (p) => p.cpu);
      void notify(
        t("notif.cpu.title", { pct: s.cpu.usage.toFixed(0) }),
        t("notif.cpu.body", { th: settings.cpu.threshold }) +
          (top ? t("notif.top", { name: top.name, v: `${top.cpu.toFixed(0)}%` }) : ""),
      );
    }

    const memPct = (s.memory.used / s.memory.total) * 100;
    if (track(tr.mem, memPct, settings.mem, now)) {
      const top = topBy(s.processes, (p) => p.memory);
      void notify(
        t("notif.mem.title", { pct: memPct.toFixed(0) }),
        t("notif.mem.body", { th: settings.mem.threshold }) +
          (top ? t("notif.top", { name: top.name, v: fmtBytes(top.memory) }) : ""),
      );
    }

    const disk = s.disks.reduce<DiskSnapshot | null>(
      (a, d) => (!a || d.active_pct > a.active_pct ? d : a),
      null,
    );
    if (disk && track(tr.disk, disk.active_pct, settings.disk, now)) {
      const top = topBy(s.processes, (p) => p.read_bps + p.write_bps);
      void notify(
        t("notif.disk.title", {
          mount: disk.mount.replace(/\\$/, ""),
          pct: disk.active_pct.toFixed(0),
        }),
        t("notif.disk.body", { th: settings.disk.threshold }) +
          (top
            ? t("notif.topIo", { name: top.name, v: fmtBytes(top.read_bps + top.write_bps, "/s") })
            : ""),
      );
    }
  }, [s, settings, t]);

  const allOff = !settings.cpu.enabled && !settings.mem.enabled && !settings.disk.enabled;

  return (
    <Popover>
      <PopoverTrigger className="widget-btn" title={t("alerts.title")}>
        {allOff ? <BellOffIcon /> : <BellIcon />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="mb-1 text-sm font-semibold">{t("alerts.title")}</div>
        <p className="mb-3 text-xs text-muted-foreground">{t("alerts.desc")}</p>
        <div className="flex flex-col gap-2">
          <Row label="CPU" rule={settings.cpu} onChange={(r) => update({ ...settings, cpu: r })} />
          <Row label="RAM" rule={settings.mem} onChange={(r) => update({ ...settings, mem: r })} />
          <Row
            label={t("alerts.disk")}
            rule={settings.disk}
            onChange={(r) => update({ ...settings, disk: r })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
