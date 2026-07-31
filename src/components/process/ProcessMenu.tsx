import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useConfirm } from "./ConfirmProvider";
import {
  blockProcessNet,
  blockRemoteIp,
  closeConnection,
  killProcess,
  killProcessTree,
  resumeProcess,
  revealItemInDir,
  suspendProcess,
  writeText,
} from "@/lib/tauri";
import { useI18n } from "@/lib/i18n";
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

// "1.2.3.4:443" -> "1.2.3.4". An IPv6 host keeps colons after the split, which
// is how we know SetTcpEntry can't touch that row.
function hostOf(addr: string): { host: string; v6: boolean } {
  const i = addr.lastIndexOf(":");
  const host = i === -1 ? addr : addr.slice(0, i);
  return { host, v6: host.includes(":") };
}

// A remote host we can write a firewall rule against (listeners and UDP rows
// report a wildcard instead).
function isRealHost(host: string): boolean {
  return host.length > 0 && host !== "*" && host !== "0.0.0.0" && host !== "::";
}

function Item({
  onClick,
  destructive,
  disabled,
  title,
  children,
}: {
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm select-none",
        !disabled && "hover:bg-accent hover:text-accent-foreground",
        destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive",
        disabled && "cursor-default opacity-50",
      )}
      title={title}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </div>
  );
}

export function ProcessMenuProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm();
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuState>(CLOSED);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLDivElement>(null);

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

  // Keep the menu inside the window. Measured rather than assumed, because the
  // widget's window is barely taller than the menu itself. Runs before paint, so
  // the first position is never visible.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu.open || !el) return;
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - el.offsetWidth - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - el.offsetHeight - 4)),
    });
  }, [menu]);

  const run = async (action: string, p: CtxTarget) => {
    try {
      if (action === "kill") {
        if (await confirm(t("confirm.kill", { name: p.name, pid: p.pid }))) {
          await killProcess(p.pid);
          toast.success(t("toast.killed", { name: p.name }));
        }
      } else if (action === "kill-tree") {
        if (await confirm(t("confirm.killTree", { name: p.name, pid: p.pid }))) {
          await killProcessTree(p.pid);
          toast.success(t("toast.treeKilled", { name: p.name }));
        }
      } else if (action === "suspend") {
        await suspendProcess(p.pid);
        toast.success(t("toast.suspended", { name: p.name }));
      } else if (action === "resume") {
        await resumeProcess(p.pid);
        toast.success(t("toast.resumed", { name: p.name }));
      } else if (action === "reveal") {
        await revealItemInDir(p.exe);
      } else if (action === "close-conn" && p.conn) {
        const { remote, local } = p.conn;
        if (await confirm(t("confirm.closeConn", { name: p.name, remote }))) {
          await closeConnection(p.pid, local, remote);
          toast.success(t("toast.connClosed", { remote }));
        }
      } else if (action === "block-net") {
        if (await confirm(t("confirm.blockNet", { name: p.name, exe: p.exe }))) {
          await blockProcessNet(p.pid, p.exe, p.name);
          toast.success(t("toast.netBlocked", { name: p.name }));
        }
      } else if (action === "block-ip" && p.conn) {
        const { host } = hostOf(p.conn.remote);
        if (await confirm(t("confirm.blockIp", { ip: host }))) {
          await blockRemoteIp(host);
          toast.success(t("toast.ipBlocked", { ip: host }));
        }
      } else if (action === "copy") {
        await writeText(`${p.name} (PID ${p.pid})`);
        toast.success(t("toast.copied"));
      }
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  const tgt = menu.target;
  const conn = tgt?.conn;
  const remote = conn ? hostOf(conn.remote) : null;
  // TCP over IPv4 only: SetTcpEntry has no IPv6 equivalent
  const canClose =
    !!conn && !!remote && conn.protocol === "TCP" && !remote.v6 && !hostOf(conn.local).v6;

  const act = (action: string) => {
    close();
    if (tgt) run(action, tgt);
  };

  return (
    <Ctx.Provider value={open}>
      {children}
      {menu.open && tgt && (
        <div
          ref={ref}
          className="fixed z-[1000] max-h-[calc(100vh-8px)] min-w-52 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: pos.left, top: pos.top }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Item destructive onClick={() => act("kill")}>
            {t("menu.kill")}
          </Item>
          <Item destructive onClick={() => act("kill-tree")}>
            {t("menu.killTree")}
          </Item>
          <div className="-mx-1 my-1 h-px bg-border" />
          <Item onClick={() => act("suspend")}>{t("menu.suspend")}</Item>
          <Item onClick={() => act("resume")}>{t("menu.resume")}</Item>
          <div className="-mx-1 my-1 h-px bg-border" />
          {conn && (
            <Item
              destructive
              disabled={!canClose}
              title={canClose ? undefined : t("menu.closeConn.only4")}
              onClick={() => act("close-conn")}
            >
              {t("menu.closeConn")}
            </Item>
          )}
          <Item
            destructive
            disabled={tgt.exe.length === 0}
            title={tgt.exe.length === 0 ? t("menu.blockNet.noExe") : tgt.exe}
            onClick={() => act("block-net")}
          >
            {t("menu.blockNet")}
          </Item>
          {remote && isRealHost(remote.host) && (
            <Item destructive onClick={() => act("block-ip")}>
              {t("menu.blockIp", { ip: remote.host })}
            </Item>
          )}
          <div className="-mx-1 my-1 h-px bg-border" />
          <Item disabled={tgt.exe.length === 0} onClick={() => act("reveal")}>
            {t("menu.reveal")}
          </Item>
          <Item onClick={() => act("copy")}>{t("menu.copy")}</Item>
        </div>
      )}
    </Ctx.Provider>
  );
}
