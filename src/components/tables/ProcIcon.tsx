import { useIcon } from "@/hooks/useIcon";

// Lazy process icon: hidden until the backend resolves the exe icon.
export function ProcIcon({ exe }: { exe: string }) {
  const src = useIcon(exe);
  return <img className="pico" alt="" src={src ?? undefined} style={src ? undefined : { visibility: "hidden" }} />;
}
