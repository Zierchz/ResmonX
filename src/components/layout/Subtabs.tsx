import { cn } from "@/lib/utils";

// Underline sub-tabs: show one table at a time within a section.
export function Subtabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="subtabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={cn("subtab", active === t.id && "active")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
