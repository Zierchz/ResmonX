// Threshold alert settings (persisted) and sustained-usage detection.

export interface AlertRule {
  enabled: boolean;
  threshold: number; // percent
}

export interface AlertSettings {
  cpu: AlertRule;
  mem: AlertRule;
  disk: AlertRule;
}

export const DEFAULT_ALERTS: AlertSettings = {
  cpu: { enabled: true, threshold: 90 },
  mem: { enabled: true, threshold: 90 },
  disk: { enabled: true, threshold: 90 },
};

const KEY = "alert-settings";

export function loadAlertSettings(): AlertSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      cpu: { ...DEFAULT_ALERTS.cpu, ...raw.cpu },
      mem: { ...DEFAULT_ALERTS.mem, ...raw.mem },
      disk: { ...DEFAULT_ALERTS.disk, ...raw.disk },
    };
  } catch {
    return DEFAULT_ALERTS;
  }
}

export function saveAlertSettings(s: AlertSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

// Wall-clock based so it still works when the hidden window's timers are
// throttled by the WebView. Hysteresis re-arm + cooldown avoid spam.
const SUSTAIN_MS = 15_000;
const REARM_PCT = 5;
const COOLDOWN_MS = 5 * 60_000;

export interface MetricTracker {
  since: number | null; // when the value first crossed the threshold
  armed: boolean;
  lastFired: number;
}

export function newTracker(): MetricTracker {
  return { since: null, armed: true, lastFired: 0 };
}

// Returns true when this sample should fire the alert.
export function track(t: MetricTracker, value: number, rule: AlertRule, now: number): boolean {
  if (!rule.enabled || value < rule.threshold) {
    t.since = null;
    if (value <= rule.threshold - REARM_PCT) t.armed = true;
    return false;
  }
  t.since ??= now;
  if (!t.armed || now - t.since < SUSTAIN_MS || now - t.lastFired < COOLDOWN_MS) return false;
  t.armed = false;
  t.lastFired = now;
  return true;
}
