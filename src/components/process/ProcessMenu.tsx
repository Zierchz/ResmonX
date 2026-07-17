import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useConfirm } from "./ConfirmProvider";
import {
  killProcess,
  killProcessTree,
  resumeProcess,
  revealItemInDir,
  suspendProcess,
  writeText,
} from "@/lib/tauri";
import type { CtxTarget } from "@/lib/types";
import { cn } from "@/lib/utils";

// One shared process menu for the whole app, opened on right-click. This avoids
// wrapping every table row in its own Radix ContextMenu (hundreds of instances
// re-rendering each poll tick — the migration's main CPU/RAM regression).
type OpenFn = (e: ReactMouseEvent | MouseEvent, target: CtxTarget) => void;

const Ctx = createContext<OpenFn>(() => {});
export function useProcessMenu() {
  return useContext(Ctx);
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  target: CtxTarget | null;
}

const CLOSED: MenuState = { open: false, x: 0, y: 0, target: null };

function Item({
  onClick,
  destructive,
  disabled,
  children,
}: {
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm select-none",
        !disabled && "hover:bg-accent hover:text-accent-foreground",
        destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </div>
  );
}

export function ProcessMenuProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm();
  const [menu, setMenu] = useState<MenuState>(CLOSED);

  const open = useCallback<OpenFn>((e, target) => {
    setMenu({ open: true, x: e.clientX, y: e.clientY, target });
  }, []);
  const close = useCallback(() => setMenu(CLOSED), []);

  // close on any outside interaction while open
  useEffect(() => {
    if (!menu.open) return;
    const onClick = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onClick, true);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onClick, true);
    };
  }, [menu.open, close]);

  const run = async (action: string, t: CtxTarget) => {
    try {
      if (action === "kill") {
        if (await confirm(`¿Finalizar el proceso "${t.name}" (PID ${t.pid})?`)) {
          await killProcess(t.pid);
          toast.success(`Proceso ${t.name} finalizado`);
        }
      } else if (action === "kill-tree") {
        if (await confirm(`¿Finalizar "${t.name}" (PID ${t.pid}) y todos sus procesos hijos?`)) {
          await killProcessTree(t.pid);
          toast.success(`Árbol de ${t.name} finalizado`);
        }
      } else if (action === "suspend") {
        await suspendProcess(t.pid);
        toast.success(`Proceso ${t.name} suspendido`);
      } else if (action === "resume") {
        await resumeProcess(t.pid);
        toast.success(`Proceso ${t.name} reanudado`);
      } else if (action === "reveal") {
        await revealItemInDir(t.exe);
      } else if (action === "copy") {
        await writeText(`${t.name} (PID ${t.pid})`);
        toast.success("Copiado al portapapeles");
      }
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  const t = menu.target;
  // clamp to the viewport (menu is ~210x300)
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - 216));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - 306));

  const act = (action: string) => {
    close();
    if (t) run(action, t);
  };

  return (
    <Ctx.Provider value={open}>
      {children}
      {menu.open && t && (
        <div
          className="fixed z-[1000] min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left, top }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Item destructive onClick={() => act("kill")}>
            Finalizar proceso
          </Item>
          <Item destructive onClick={() => act("kill-tree")}>
            Finalizar árbol de procesos
          </Item>
          <div className="-mx-1 my-1 h-px bg-border" />
          <Item onClick={() => act("suspend")}>Suspender</Item>
          <Item onClick={() => act("resume")}>Reanudar</Item>
          <div className="-mx-1 my-1 h-px bg-border" />
          <Item disabled={t.exe.length === 0} onClick={() => act("reveal")}>
            Abrir ubicación del archivo
          </Item>
          <Item onClick={() => act("copy")}>Copiar</Item>
        </div>
      )}
    </Ctx.Provider>
  );
}
