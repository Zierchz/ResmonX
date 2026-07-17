import { sevClass } from "@/lib/format";

// Severity-colored usage bar + percentage readout (for a numeric cell).
export function UsageBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <>
      <span className="usage-bar">
        <span className={`usage-fill ${sevClass(p)}`} style={{ width: `${p.toFixed(0)}%` }} />
      </span>
      {p.toFixed(0)}%
    </>
  );
}
