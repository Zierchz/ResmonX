import { RefreshCwIcon, DownloadIcon, LoaderIcon } from "lucide-react";
import { useConfirm } from "@/components/process/ConfirmProvider";
import { useUpdate } from "@/hooks/useUpdate";

export function UpdateButton() {
  const { status, version, notes, progress, checkNow, install } = useUpdate();
  const confirm = useConfirm();

  const onClick = async () => {
    if (status === "available") {
      const msg = `¿Actualizar ResmonX a la versión ${version}? Se descargará, instalará y reiniciará la app.${
        notes ? `\n\n${notes}` : ""
      }`;
      if (await confirm(msg)) void install();
      return;
    }
    if (status !== "checking" && status !== "downloading") void checkNow();
  };

  // Icon + label + tooltip per state.
  const busy = status === "checking" || status === "downloading";
  const pulse = status === "available";
  const title =
    status === "available"
      ? `Actualizar a la versión ${version}`
      : status === "downloading"
        ? "Descargando actualización…"
        : status === "checking"
          ? "Buscando actualizaciones…"
          : status === "error"
            ? "Error al buscar; reintentar"
            : "Buscar actualizaciones";

  return (
    <button
      className={`widget-btn${pulse ? " animate-pulse" : ""}`}
      onClick={() => void onClick()}
      disabled={busy}
      title={title}
    >
      {status === "downloading" ? (
        <LoaderIcon className="animate-spin" />
      ) : status === "available" ? (
        <DownloadIcon />
      ) : (
        <RefreshCwIcon className={status === "checking" ? "animate-spin" : ""} />
      )}
      {status === "available" && <span>{version}</span>}
      {status === "downloading" && <span>{progress}%</span>}
    </button>
  );
}
