import { RefreshCwIcon, DownloadIcon, LoaderIcon } from "lucide-react";
import { useConfirm } from "@/components/process/ConfirmProvider";
import { useUpdate } from "@/hooks/useUpdate";
import { useI18n } from "@/lib/i18n";

export function UpdateButton() {
  const { status, version, progress, checkNow, install } = useUpdate();
  const confirm = useConfirm();
  const { t } = useI18n();

  const onClick = async () => {
    if (status === "available") {
      if (await confirm(t("update.confirm", { v: version ?? "" }))) void install();
      return;
    }
    if (status !== "checking" && status !== "downloading") void checkNow();
  };

  // Icon + label + tooltip per state.
  const busy = status === "checking" || status === "downloading";
  const pulse = status === "available";
  const title =
    status === "available"
      ? t("update.install", { v: version ?? "" })
      : status === "downloading"
        ? t("update.downloading")
        : status === "checking"
          ? t("update.checking")
          : status === "error"
            ? t("update.retry")
            : t("update.check");

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
