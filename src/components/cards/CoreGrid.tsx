import { coreBlue } from "@/lib/format";

export function CoreGrid({ perCore }: { perCore: number[] }) {
  return (
    <div className="core-grid">
      {perCore.map((u, i) => (
        <div className="core-cell" key={i}>
          <div className="core-label">
            <span>N{i}</span>
            <span>{u.toFixed(0)}%</span>
          </div>
          <div className="core-track">
            <div
              className="core-fill"
              style={{ width: `${Math.min(u, 100).toFixed(0)}%`, background: coreBlue(u) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
