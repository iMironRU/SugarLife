/* Живые метрики из treatments: болюсы, углеводы, базал, возрасты устройств. */
import type { Treatment } from './nightscout';

// Проинтегрированный базал (ед) из temp basal: rate × длительность сегмента.
export function basalDelivered(ts: Treatment[]): number {
  const tb = ts.filter((t) => t.type === 'Temp Basal' && t.rate != null).sort((a, b) => a.t - b.t);
  let total = 0;
  for (let i = 0; i < tb.length; i++) {
    let segMs = i < tb.length - 1 ? tb[i + 1].t - tb[i].t : (tb[i].duration ? tb[i].duration! * 60000 : 0);
    if (tb[i].duration != null) segMs = Math.min(segMs || tb[i].duration! * 60000, tb[i].duration! * 60000);
    total += (tb[i].rate as number) * (Math.max(0, segMs) / 3600000);
  }
  return total;
}

// Болюсы из событий (insulin > 0)
export function bolusStats(events: Treatment[], days: number) {
  const b = events.filter((t) => t.insulin && t.insulin > 0);
  const total = b.reduce((a, x) => a + (x.insulin || 0), 0);
  const d = Math.max(1, days);
  return { perDay: total / d, count: Math.round(b.length / d), avg: b.length ? total / b.length : 0, total };
}

export interface CarbStats { perDay: number; mealCount: number; avgPerMeal: number; breakfast: number; dinner: number; hasData: boolean; }
export function carbStats(events: Treatment[], days: number): CarbStats {
  const carbs = events.filter((t) => t.carbs && t.carbs > 0);
  const total = carbs.reduce((a, b) => a + (b.carbs || 0), 0);
  const d = Math.max(1, days);
  const inH = (t: Treatment, lo: number, hi: number) => { const h = new Date(t.t).getHours(); return h >= lo && h < hi; };
  return {
    perDay: total / d, mealCount: Math.round(carbs.length / d),
    avgPerMeal: carbs.length ? total / carbs.length : 0,
    breakfast: carbs.filter((t) => inH(t, 5, 11)).reduce((a, b) => a + (b.carbs || 0), 0) / d,
    dinner: carbs.filter((t) => inH(t, 17, 23)).reduce((a, b) => a + (b.carbs || 0), 0) / d,
    hasData: carbs.length > 0,
  };
}

// Возрасты устройств из событий замен
export interface Age { at: number; days: number; hours: number; }
function latest(events: Treatment[], types: string[]): number | null {
  const xs = events.filter((e) => types.includes(e.type));
  return xs.length ? xs[xs.length - 1].t : null; // events отсортированы по возрастанию
}
function age(t: number | null): Age | null {
  if (t == null) return null;
  const ms = Date.now() - t;
  return { at: t, days: Math.floor(ms / 86400000), hours: Math.floor(ms / 3600000) };
}
export interface DeviceAges { sensor: Age | null; site: Age | null; reservoir: Age | null; battery: Age | null; }
export function deviceAges(events: Treatment[]): DeviceAges {
  return {
    sensor: age(latest(events, ['Sensor Change', 'Sensor Start'])),
    site: age(latest(events, ['Site Change'])),
    reservoir: age(latest(events, ['Insulin Change'])),
    battery: age(latest(events, ['Pump Battery Change'])),
  };
}
