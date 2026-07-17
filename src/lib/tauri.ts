import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Snapshot } from "./types";

// Typed wrappers around the backend commands (contract unchanged).
export const getSnapshot = () => invoke<Snapshot>("get_snapshot");
export const getIcon = (path: string) => invoke<string | null>("get_icon", { path });
export const killProcess = (pid: number) => invoke("kill_process", { pid });
export const killProcessTree = (pid: number) => invoke("kill_process_tree", { pid });
export const suspendProcess = (pid: number) => invoke("suspend_process", { pid });
export const resumeProcess = (pid: number) => invoke("resume_process", { pid });

export { revealItemInDir, writeText };
