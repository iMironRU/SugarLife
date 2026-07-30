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

/*
 * Суточная доза инсулина честно: на помпе Medtronic через AAPS весь инсулин
 * (базал + коррекции петли) идёт через temp basal, дискретные болюсы — отдельно.
 * Nightscout за многие дни залит частично (аплоадер офлайн) → усредняем ТОЛЬКО
 * по дням с достаточным покрытием, иначе полупустые дни занижают среднее.
 */
const COVERAGE_MIN = 0.7; // день учитываем, если покрыт temp basal ≥70% суток
export interface InsulinDaily {
  basalPerDay: number; bolusPerDay: number; tddPerDay: number;
  bolusAvg: number; bolusCount: number;
  coveredDays: number; totalDays: number;
}
export function insulinDaily(tempBasals: Treatment[], boluses: Treatment[]): InsulinDaily {
  const tb = tempBasals.filter((t) => t.type === 'Temp Basal' && t.rate != null).sort((a, b) => a.t - b.t);
  const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  // интегрируем temp basal по календарным дням + считаем покрытие
  const days = new Map<string, { basal: number; covMs: number; bolus: number }>();
  const get = (k: string) => { let v = days.get(k); if (!v) { v = { basal: 0, covMs: 0, bolus: 0 }; days.set(k, v); } return v; };
  for (let i = 0; i < tb.length; i++) {
    let segMs = i < tb.length - 1 ? tb[i + 1].t - tb[i].t : (tb[i].duration ? tb[i].duration! * 60000 : 0);
    if (tb[i].duration != null) segMs = Math.min(segMs || tb[i].duration! * 60000, tb[i].duration! * 60000);
    segMs = Math.max(0, segMs);
    const d = get(dayKey(tb[i].t));
    d.basal += (tb[i].rate as number) * (segMs / 3600000);
    d.covMs += segMs;
  }
  // болюсы раскладываем по тем же дням
  const bo = boluses.filter((t) => t.insulin && t.insulin > 0);
  for (const b of bo) get(dayKey(b.t)).bolus += b.insulin || 0;

  const covered = [...days.values()].filter((d) => d.covMs >= COVERAGE_MIN * 86400e3);
  const n = covered.length;
  const basalPerDay = n ? covered.reduce((a, d) => a + d.basal, 0) / n : 0;
  const bolusPerDay = n ? covered.reduce((a, d) => a + d.bolus, 0) / n : 0;
  // средний болюс и число болюсов/день — по болюсам в покрытых днях
  const covKeys = new Set([...days.entries()].filter(([, d]) => d.covMs >= COVERAGE_MIN * 86400e3).map(([k]) => k));
  const covBoluses = bo.filter((b) => covKeys.has(dayKey(b.t)));
  const bolusAvg = covBoluses.length ? covBoluses.reduce((a, b) => a + (b.insulin || 0), 0) / covBoluses.length : 0;
  return {
    basalPerDay, bolusPerDay, tddPerDay: basalPerDay + bolusPerDay,
    bolusAvg, bolusCount: n ? Math.round(covBoluses.length / n) : 0,
    coveredDays: n, totalDays: days.size,
  };
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
