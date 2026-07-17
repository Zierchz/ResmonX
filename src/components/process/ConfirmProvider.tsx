import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmCtx);
}

const noop = () => {};

// Promise-based confirm() backed by a single AlertDialog (replaces the old
// hand-rolled overlay dialog).
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ open: false, message: "" });
  const resolver = useRef<(v: boolean) => void>(noop);

  const confirm = useCallback<ConfirmFn>((message) => {
    setState({ open: true, message });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (val: boolean) => {
    resolver.current(val);
    resolver.current = noop;
    setState((s) => ({ ...s, open: false }));
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AlertDialog
        open={state.open}
        onOpenChange={(o) => {
          if (!o) close(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar acción</AlertDialogTitle>
            <AlertDialogDescription>{state.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => close(true)}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmCtx.Provider>
  );
}
