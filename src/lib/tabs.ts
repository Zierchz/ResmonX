export type TabId = "overview" | "cpu" | "memory" | "disk" | "network" | "processes" | "gpu";

// title shown in the top bar per section
export const TITLES: Record<TabId, string> = {
  overview: "Resumen",
  cpu: "CPU",
  memory: "Memoria",
  disk: "Disco",
  network: "Red",
  processes: "Procesos",
  gpu: "GPU",
};
