import { toggleWidget } from "@/lib/tauri";
import { UpdateButton } from "@/components/layout/UpdateButton";
import type { Snapshot } from "@/lib/types";

export function Topbar({ title, snapshot: s }: { title: string; snapshot: Snapshot | null }) {
  const cpu = s ? `CPU ${s.cpu.usage.toFixed(0)}%` : "CPU —";
  const freq = s ? `${(s.cpu.freq_mhz / 1000).toFixed(2)} GHz` : "— GHz";
  const mem = s ? `RAM ${((s.memory.used / s.memory.total) * 100).toFixed(0)}%` : "RAM —";
  const gpu = s?.gpu ? `GPU ${s.gpu.utilization}%` : "GPU n/d";
  return (
    <header className="topbar">
      <div className="view-title">{title}</div>
      <div className="topbar-right">
        <div className="topbar-stats">
          <span className="stat">{cpu}</span>
          <span className="stat">{freq}</span>
          <span className="stat">{mem}</span>
          <span className="stat">{gpu}</span>
        </div>
        <button
          className="widget-btn"
          onClick={() => void toggleWidget()}
          title="Mostrar/ocultar widget flotante"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <rect x="12" y="12" width="7" height="6" rx="1" />
          </svg>
          Widget
        </button>
        <UpdateButton />
      </div>
    </header>
  );
}
