/* Живые метрики углеводов и инсулина из treatments Nightscout. */
import type { Treatment } from './nightscout';

// Проинтегрированный базал (ед) из temp basal: rate × длительность сегмента.
// Сегмент = время до следующего temp basal, но не больше его собственной длительности.
function basalDelivered(ts: Treatment[]): number {
  const tb = ts.filter((t) => t.type === 'Temp Basal' && t.rate != null).sort((a, b) => a.t - b.t);
  let total = 0;
  for (let i = 0; i < tb.length; i++) {
    let segMs = i < tb.length - 1 ? tb[i + 1].t - tb[i].t : (tb[i].duration ? tb[i].duration! * 60000 : 0);
    if (tb[i].duration != null) segMs = Math.min(segMs || tb[i].duration! * 60000, tb[i].duration! * 60000);
    total += (tb[i].rate as number) * (Math.max(0, segMs) / 3600000);
  }
  return total;
}

export interface InsulinStats {
  tddPerDay: number; basalPerDay: number; bolusPerDay: number;
  bolusCount: number; avgBolus: number;
}
export function insulinStats(ts: Treatment[], days: number): InsulinStats {
  const boluses = ts.filter((t) => t.insulin && t.insulin > 0);
  const bolusTotal = boluses.reduce((a, b) => a + (b.insulin || 0), 0);
  const basalTotal = basalDelivered(ts);
  const d = Math.max(1, days);
  return {
    tddPerDay: (basalTotal + bolusTotal) / d,
    basalPerDay: basalTotal / d,
    bolusPerDay: bolusTotal / d,
    bolusCount: Math.round(boluses.length / d),
    avgBolus: boluses.length ? bolusTotal / boluses.length : 0,
  };
}

export interface CarbStats {
  perDay: number; mealCount: number; avgPerMeal: number;
  breakfast: number; dinner: number; hasData: boolean;
}
export function carbStats(ts: Treatment[], days: number): CarbStats {
  const carbs = ts.filter((t) => t.carbs && t.carbs > 0);
  const total = carbs.reduce((a, b) => a + (b.carbs || 0), 0);
  const d = Math.max(1, days);
  const inHours = (t: Treatment, lo: number, hi: number) => { const h = new Date(t.t).getHours(); return h >= lo && h < hi; };
  const breakfast = carbs.filter((t) => inHours(t, 5, 11)).reduce((a, b) => a + (b.carbs || 0), 0) / d;
  const dinner = carbs.filter((t) => inHours(t, 17, 23)).reduce((a, b) => a + (b.carbs || 0), 0) / d;
  return {
    perDay: total / d, mealCount: Math.round(carbs.length / d),
    avgPerMeal: carbs.length ? total / carbs.length : 0,
    breakfast, dinner, hasData: carbs.length > 0,
  };
}
