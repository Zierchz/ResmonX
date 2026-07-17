import type { CSSProperties } from "react";

// single accent for sparklines and values (matches --primary in CSS)
export const ACCENT = "#6d8db3";

export const COLORS = {
  cpu: ACCENT,
  mem: ACCENT,
  net: ACCENT,
  disk: ACCENT,
  gpu: ACCENT,
};

export function fmtBytes(b: number, suffix = ""): string {
  if (b < 1024) return `${b.toFixed(0)} B${suffix}`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}${suffix}`;
}

// severity class based on usage percentage
export function sevClass(pct: number): string {
  if (pct >= 85) return "sev-crit";
  if (pct >= 60) return "sev-warn";
  return "sev-ok";
}

// heatmap-style background (Task Manager): translucent orange by intensity
export function heat(ratio: number): CSSProperties | undefined {
  const r = Math.max(0, Math.min(1, ratio));
  if (r < 0.01) return undefined;
  return { background: `rgba(255, 140, 0, ${(0.1 + 0.5 * r).toFixed(3)})` };
}

// blue tone based on core load: dim at idle, bright under load
export function coreBlue(pct: number): string {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  return `hsl(210 55% ${(34 + p * 34).toFixed(0)}%)`;
}
