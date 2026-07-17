import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TabId } from "@/lib/tabs";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  {
    id: "overview",
    label: "Resumen",
    icon: <img className="nav-logo" src="/logo.svg" alt="" width={24} height={24} />,
  },
  {
    id: "cpu",
    label: "CPU",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="6" y="6" width="8" height="8" rx="1" />
        <rect x="4.5" y="4.5" width="11" height="11" rx="2" />
        <path d="M8 4.5V2M12 4.5V2M8 15.5V18M12 15.5V18M4.5 8H2M4.5 12H2M15.5 8H18M15.5 12H18" />
      </svg>
    ),
  },
  {
    id: "memory",
    label: "Memoria",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.5" y="6" width="15" height="8" rx="1" />
        <path d="M6 14v2M10 14v2M14 14v2M6 9v2M10 9v2M14 9v2" />
      </svg>
    ),
  },
  {
    id: "disk",
    label: "Disco",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <ellipse cx="10" cy="5.5" rx="6.5" ry="2.5" />
        <path d="M3.5 5.5v9c0 1.38 2.91 2.5 6.5 2.5s6.5-1.12 6.5-2.5v-9M3.5 10c0 1.38 2.91 2.5 6.5 2.5s6.5-1.12 6.5-2.5" />
      </svg>
    ),
  },
  {
    id: "network",
    label: "Red",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 13l4-4 3 3 7-7M17 5v4M17 5h-4" />
        <path d="M3 17h14" />
      </svg>
    ),
  },
  {
    id: "processes",
    label: "Procesos",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 5h12M4 10h12M4 15h12" />
        <circle cx="4" cy="5" r="0.5" />
      </svg>
    ),
  },
  {
    id: "gpu",
    label: "GPU",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
        <circle cx="7" cy="10" r="2.2" />
        <circle cx="13" cy="10" r="2.2" />
      </svg>
    ),
  },
];

export function Sidebar({ active, onSelect }: { active: TabId; onSelect: (t: TabId) => void }) {
  return (
    <aside className="sidebar">
      <nav className="nav">
        {TABS.map((t) => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <button
                className={cn("nav-item", active === t.id && "active")}
                onClick={() => onSelect(t.id)}
                aria-label={t.label}
              >
                {t.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t.label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </aside>
  );
}
