import { useEffect, useState } from "react";
import { getIcon } from "@/lib/tauri";

// Icon cache survives across renders (module-level). null = no icon.
const iconCache = new Map<string, string | null>();
const iconInflight = new Map<string, Promise<string | null>>();

function loadIcon(exe: string): Promise<string | null> {
  const cached = iconCache.get(exe);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = iconInflight.get(exe);
  if (inflight) return inflight;
  const p = getIcon(exe)
    .then((uri) => {
      const val = uri ?? null;
      iconCache.set(exe, val);
      iconInflight.delete(exe);
      return val;
    })
    .catch(() => {
      iconInflight.delete(exe);
      return null;
    });
  iconInflight.set(exe, p);
  return p;
}

// Returns the cached/loaded data-URI for an exe path, or null while unknown.
export function useIcon(exe: string): string | null {
  const [src, setSrc] = useState<string | null>(() => iconCache.get(exe) ?? null);

  useEffect(() => {
    if (!exe) {
      setSrc(null);
      return;
    }
    const cached = iconCache.get(exe);
    if (cached !== undefined) {
      setSrc(cached);
      return;
    }
    let alive = true;
    loadIcon(exe).then((uri) => {
      if (alive) setSrc(uri);
    });
    return () => {
      alive = false;
    };
  }, [exe]);

  return src;
}
