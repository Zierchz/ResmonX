import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ConfirmProvider } from "@/components/process/ConfirmProvider";
import { ProcessMenuProvider } from "@/components/process/ProcessMenu";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSnapshot } from "@/hooks/useSnapshot";
import { TITLES, type TabId } from "@/lib/tabs";
import { Overview } from "@/components/views/Overview";
import { Cpu } from "@/components/views/Cpu";
import { Memory } from "@/components/views/Memory";
import { Disk } from "@/components/views/Disk";
import { Network } from "@/components/views/Network";
import { Processes } from "@/components/views/Processes";
import { Gpu } from "@/components/views/Gpu";
import type { History, Snapshot } from "@/lib/types";

function ViewSwitch({
  tab,
  snapshot,
  history,
}: {
  tab: TabId;
  snapshot: Snapshot;
  history: History;
}) {
  switch (tab) {
    case "overview":
      return <Overview snapshot={snapshot} history={history} />;
    case "cpu":
      return <Cpu snapshot={snapshot} history={history} />;
    case "memory":
      return <Memory snapshot={snapshot} history={history} />;
    case "disk":
      return <Disk snapshot={snapshot} history={history} />;
    case "network":
      return <Network snapshot={snapshot} history={history} />;
    case "processes":
      return <Processes snapshot={snapshot} history={history} />;
    case "gpu":
      return <Gpu snapshot={snapshot} history={history} />;
    default:
      return null;
  }
}

export default function App() {
  const [tab, setTab] = useState<TabId>("overview");
  const { snapshot, history } = useSnapshot();

  // Suppress the WebView's native context menu everywhere except text inputs
  // (Radix row menus handle their own preventDefault).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  // The widget's row clicks ask the main window to switch tabs.
  useEffect(() => {
    const un = listen<string>("switch-tab", (e) => setTab(e.payload as TabId));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return (
    <ConfirmProvider>
      <ProcessMenuProvider>
        <TooltipProvider delayDuration={200}>
          <div className="app-shell">
            <Sidebar active={tab} onSelect={setTab} />
            <div className="main-area">
              <Topbar title={TITLES[tab]} snapshot={snapshot} />
              <main className="content">
                {snapshot && <ViewSwitch tab={tab} snapshot={snapshot} history={history} />}
              </main>
            </div>
          </div>
        </TooltipProvider>
      </ProcessMenuProvider>
      <Toaster position="bottom-right" />
    </ConfirmProvider>
  );
}
