import { HISTORY_LEN } from "@/hooks/useSnapshot";
import { ACCENT } from "@/lib/format";

export function Sparkline({
  values,
  max,
  color = ACCENT,
}: {
  values: number[];
  max: number;
  color?: string;
}) {
  const w = 260;
  const h = 60;
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} />;
  const step = w / (HISTORY_LEN - 1);
  const x0 = w - (values.length - 1) * step;
  const pts = values.map(
    (v, i) => `${(x0 + i * step).toFixed(1)},${(h - (Math.min(v, max) / max) * h).toFixed(1)}`,
  );
  const firstX = pts[0].split(",")[0];
  const lastX = pts[pts.length - 1].split(",")[0];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={`${firstX},${h} ${pts.join(" ")} ${lastX},${h}`} fill={`${color}22`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
