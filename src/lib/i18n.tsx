import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { es } from "@/locales/es";
import { en } from "@/locales/en";

export type Lang = "es" | "en";
export type MsgKey = keyof typeof es;
export type TFn = (k: MsgKey, params?: Record<string, string | number>) => string;

const DICTS: Record<Lang, Record<MsgKey, string>> = { es, en };
const KEY = "lang";

function loadLang(): Lang {
  const saved = localStorage.getItem(KEY);
  if (saved === "es" || saved === "en") return saved;
  // no explicit choice: follow the system language if available, else English
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const Ctx = createContext<I18n>({ lang: "es", setLang: () => {}, t: (k) => es[k] });

export function useI18n() {
  return useContext(Ctx);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(KEY, l);
  }, []);

  // main window and widget share localStorage; follow changes from the other one
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === KEY) setLangState(loadLang());
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const t = useCallback<TFn>(
    (k, params) => {
      let s: string = DICTS[lang][k] ?? k;
      if (params) {
        for (const [p, v] of Object.entries(params)) s = s.replace(`{${p}}`, String(v));
      }
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
