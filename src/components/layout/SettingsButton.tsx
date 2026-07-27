import { useEffect, useState } from "react";
import { SettingsIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n, type Lang } from "@/lib/i18n";
import { getAutostart, setAutostart } from "@/lib/tauri";

const LANGS: { id: Lang; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

// Gear in the topbar: app settings (start with Windows, language).
export function SettingsButton() {
  const { t, lang, setLang } = useI18n();
  const [autostart, setAutostartState] = useState(false);

  // re-read on open too, in case it was toggled from the tray menu
  const refresh = () => void getAutostart().then(setAutostartState);
  useEffect(refresh, []);

  const toggle = async (on: boolean) => {
    setAutostartState(on);
    try {
      await setAutostart(on);
    } catch {
      refresh();
    }
  };

  return (
    <Popover onOpenChange={(open) => open && refresh()}>
      <PopoverTrigger className="widget-btn" title={t("settings.title")}>
        <SettingsIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="mb-3 text-sm font-semibold">{t("settings.title")}</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-(--primary)"
            checked={autostart}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t("settings.autostart")}
        </label>
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.autostartHint")}</p>
        <div className="mt-4 mb-2 text-sm">{t("settings.language")}</div>
        <div className="flex flex-col gap-1.5">
          {LANGS.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="lang"
                className="accent-(--primary)"
                checked={lang === l.id}
                onChange={() => setLang(l.id)}
              />
              {l.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
