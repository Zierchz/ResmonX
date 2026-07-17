import { fmtBytes } from "@/lib/format";

export interface DonutSeg {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  total,
  centerPct,
  centerCaption,
}: {
  segments: DonutSeg[];
  total: number;
  centerPct: number;
  centerCaption: string;
}) {
  let acc = 0;
  const rings = segments.map((g, i) => {
    const frac = total > 0 ? (g.value / total) * 100 : 0;
    // pathLength=100 => dasharray/offset in percentage units
    const seg = (
      <circle
        key={i}
        cx="60"
        cy="60"
        r="46"
        fill="none"
        stroke={g.color}
        strokeWidth="15"
        pathLength={100}
        strokeDasharray={`${frac.toFixed(2)} ${(100 - frac).toFixed(2)}`}
        strokeDashoffset={(-acc).toFixed(2)}
      />
    );
    acc += frac;
    return seg;
  });

  return (
    <div className="donut-panel">
      <svg className="donut" viewBox="0 0 120 120">
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r="46" fill="none" stroke="var(--secondary)" strokeWidth="15" />
          {rings}
        </g>
        <text className="donut-val" x="60" y="58" textAnchor="middle">
          {centerPct.toFixed(0)}%
        </text>
        <text className="donut-cap" x="60" y="74" textAnchor="middle">
          {centerCaption}
        </text>
      </svg>
      <div className="legend">
        {segments.map((g, i) => (
          <span className="legend-item" key={i}>
            <span className="dot" style={{ background: g.color }} />
            {g.label} · {fmtBytes(g.value)}
          </span>
        ))}
      </div>
    </div>
  );
}
