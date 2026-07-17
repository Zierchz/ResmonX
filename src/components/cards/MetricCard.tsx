import type { CSSProperties, ReactNode } from "react";

export function MetricCard({
  title,
  value,
  detail,
  accent,
  children,
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  accent?: string;
  children?: ReactNode;
}) {
  const style = accent ? ({ "--card-accent": accent } as CSSProperties) : undefined;
  return (
    <div className="card" style={style}>
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      <div className="card-detail">{detail}</div>
      {children}
    </div>
  );
}
