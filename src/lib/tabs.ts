import type { MsgKey } from "@/lib/i18n";

export type TabId = "overview" | "cpu" | "memory" | "disk" | "network" | "processes" | "gpu";

// i18n key of the title shown in the top bar and sidebar per section
export const TITLES: Record<TabId, MsgKey> = {
  overview: "tab.overview",
  cpu: "tab.cpu",
  memory: "tab.memory",
  disk: "tab.disk",
  network: "tab.network",
  processes: "tab.processes",
  gpu: "tab.gpu",
};
