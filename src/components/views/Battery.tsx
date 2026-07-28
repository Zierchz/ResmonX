import { BatteryCard, battState } from "@/components/cards/resourceCards";
import { MetricCard } from "@/components/cards/MetricCard";
import { Sparkline } from "@/components/cards/Sparkline";
import { COLORS } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ViewProps } from "./props";

const wh = (mwh: number) => `${(mwh / 1000).toFixed(1)} Wh`;

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function Battery({ snapshot: s, history }: ViewProps) {
  const { t } = useI18n();
  const b = s.battery;

  if (!b) {
    return (
      <div className="cards">
        <MetricCard title={t("tab.battery")} value={t("batt.na")} detail={t("batt.naDetail")} />
      </div>
    );
  }

  const health = (b.full_mwh / Math.max(1, b.design_mwh)) * 100;
  return (
    <div className="split">
      <aside className="split-aside">
        <h2 className="section-title first">{t("sec.summary")}</h2>
        <div className="cards stacked">
          <BatteryCard s={s} history={history} />
          <MetricCard
            title={t("card.power")}
            value={`${(Math.abs(b.rate_mw) / 1000).toFixed(1)} W`}
            detail={t(battState(b))}
            accent={COLORS.batt}
          >
            <Sparkline
              values={history.battMw}
              max={Math.max(...history.battMw, 1)}
              color={COLORS.batt}
            />
          </MetricCard>
          <MetricCard
            title={t("card.timeLeft")}
            value={b.time_remaining_s != null ? fmtDur(b.time_remaining_s) : t("na")}
            detail={t("card.timeLeft.detail")}
            accent={COLORS.batt}
          />
        </div>
      </aside>
      <div className="split-main">
        <h2 className="section-title first">{t("sec.battHealth")}</h2>
        <div className="cards">
          <MetricCard
            title={t("card.health")}
            value={`${health.toFixed(0)}%`}
            detail={t("card.health.detail", { full: wh(b.full_mwh), design: wh(b.design_mwh) })}
            accent={COLORS.batt}
          />
          <MetricCard
            title={t("card.capacity")}
            value={`${wh(b.remaining_mwh)} / ${wh(b.full_mwh)}`}
            detail={t("card.capacity.detail")}
            accent={COLORS.batt}
          />
          <MetricCard
            title={t("card.voltage")}
            value={`${(b.voltage_mv / 1000).toFixed(2)} V`}
            detail={b.chemistry}
            accent={COLORS.batt}
          />
          <MetricCard
            title={t("card.saver")}
            value={b.saver ? t("batt.saverOn") : t("batt.saverOff")}
            detail={t("card.saver.detail")}
            accent={COLORS.batt}
          />
        </div>
      </div>
    </div>
  );
}
