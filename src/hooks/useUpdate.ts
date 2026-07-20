import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "uptodate"
  | "error";

// Wraps the Tauri updater: checks on startup, exposes a manual check and the
// download+install flow. `check()` only returns a value when the published
// version is greater than the installed one.
export function useUpdate() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0..100
  const update = useRef<Update | null>(null);

  const checkNow = useCallback(async () => {
    setStatus("checking");
    try {
      const u = await check();
      if (u) {
        update.current = u;
        setVersion(u.version);
        setNotes(u.body ?? null);
        setStatus("available");
      } else {
        update.current = null;
        setStatus("uptodate");
      }
    } catch {
      setStatus("error");
    }
  }, []);

  // Check once on startup.
  useEffect(() => {
    void checkNow();
  }, [checkNow]);

  const install = useCallback(async () => {
    const u = update.current;
    if (!u) return;
    setStatus("downloading");
    setProgress(0);
    try {
      // Stop the elevated helper first: it holds the .exe open and the
      // unelevated installer can't kill an elevated process.
      await invoke("shutdown_helper");
      let total = 0;
      let done = 0;
      await u.downloadAndInstall((e) => {
        switch (e.event) {
          case "Started":
            total = e.data.contentLength ?? 0;
            break;
          case "Progress":
            done += e.data.chunkLength;
            if (total > 0) setProgress(Math.round((done / total) * 100));
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      await relaunch();
    } catch {
      setStatus("error");
    }
  }, []);

  return { status, version, notes, progress, checkNow, install };
}
