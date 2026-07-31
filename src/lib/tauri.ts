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
export const closeConnection = (pid: number, local: string, remote: string) =>
  invoke("close_connection", { pid, local, remote });
export const blockProcessNet = (pid: number, exe: string, label: string) =>
  invoke("block_process_net", { pid, exe, label });
export const blockRemoteIp = (ip: string) => invoke("block_remote_ip", { ip });
export const removeFirewallRule = (id: number) => invoke("remove_firewall_rule", { id });
export const openMainTab = (tab: string) => invoke("open_main_tab", { tab });
export const getAutostart = () => invoke<boolean>("get_autostart");
export const setAutostart = (enabled: boolean) => invoke("set_autostart", { enabled });

// translated tray labels + window title (mirrors UiLabels in lib.rs)
export interface UiLabels {
  widget: string;
  showMain: string;
  autostart: string;
  quit: string;
  title: string;
}
export const setUiLanguage = (labels: UiLabels) => invoke("set_ui_language", { labels });

export { revealItemInDir, writeText };
