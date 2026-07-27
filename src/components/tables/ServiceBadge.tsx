import { useI18n, type MsgKey } from "@/lib/i18n";

// state arrives as a stable code from the backend (see services.rs)
const LABELS: Record<string, MsgKey> = {
  stopped: "svc.stopped",
  starting: "svc.starting",
  stopping: "svc.stopping",
  running: "svc.running",
  resuming: "svc.resuming",
  pausing: "svc.pausing",
  paused: "svc.paused",
};

// Windows service state badge (running / stopped / other).
export function ServiceBadge({ state }: { state: string }) {
  const { t } = useI18n();
  const cls =
    state === "running" ? "badge-run" : state === "stopped" ? "badge-stop" : "badge-other";
  const key = LABELS[state];
  return <span className={`badge ${cls}`}>{key ? t(key) : state}</span>;
}
