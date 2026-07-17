import { useEffect, useRef, useState } from "react";
import { getSnapshot } from "@/lib/tauri";
import type { History, Snapshot } from "@/lib/types";

const HISTORY_LEN = 120;
const POLL_MS = 1500;

function push(arr: number[], v: number) {
  // first sample: fill the history so the sparkline is complete
  if (arr.length === 0) {
    for (let i = 0; i < HISTORY_LEN; i++) arr.push(v);
    return;
  }
  arr.push(v);
  if (arr.length > HISTORY_LEN) arr.shift();
}

function emptyHistory(): History {
  return { cpu: [], mem: [], rx: [], tx: [], gpu: [], read: [], write: [] };
}

// Polls get_snapshot every POLL_MS. History rings live in a ref (no re-render
// churn); the snapshot setState drives the re-render each tick.
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const historyRef = useRef<History>(emptyHistory());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await getSnapshot();
        if (!alive) return;
        const h = historyRef.current;
        push(h.cpu, s.cpu.usage);
        push(h.mem, (s.memory.used / s.memory.total) * 100);
        push(h.rx, s.nics.reduce((a, n) => a + n.rx_bps, 0));
        push(h.tx, s.nics.reduce((a, n) => a + n.tx_bps, 0));
        push(h.gpu, s.gpu?.utilization ?? 0);
        push(h.read, s.processes.reduce((a, p) => a + p.read_bps, 0));
        push(h.write, s.processes.reduce((a, p) => a + p.write_bps, 0));
        setSnapshot(s);
      } catch (e) {
        console.error("snapshot error", e);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { snapshot, history: historyRef.current, HISTORY_LEN };
}

export { HISTORY_LEN };
