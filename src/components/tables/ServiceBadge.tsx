// Windows service state badge (running / stopped / other).
export function ServiceBadge({ state }: { state: string }) {
  const cls =
    state === "En ejecución" ? "badge-run" : state === "Detenido" ? "badge-stop" : "badge-other";
  return <span className={`badge ${cls}`}>{state}</span>;
}
