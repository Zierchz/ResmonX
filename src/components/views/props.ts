import type { History, Snapshot } from "@/lib/types";

// Views receive a non-null snapshot (App renders them only once data exists).
export interface ViewProps {
  snapshot: Snapshot;
  history: History;
}
