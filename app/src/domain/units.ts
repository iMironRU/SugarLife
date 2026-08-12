import { MGDL_PER_MMOL } from '@/domain/types';
/* Форматирование глюкозы/времени + глобальный выбор единиц (ммоль/л ⇄ мг/дл).
   Внимание: конвертируется ТОЛЬКО глюкоза. Инсулин/углеводы форматируются
   через fmt() и единицами не затрагиваются. */
import { useSyncExternalStore } from 'react';
import { прочитать, записать } from '@/settings/storage';

export type Unit = 'mmol' | 'mgdl';

const KEY = 'sl.units';

let unit: Unit = (прочитать(KEY) as Unit) || 'mmol';
const subs = new Set<() => void>();

export function getUnit(): Unit { return unit; }
export function setUnit(u: Unit) {
  if (u === unit) return;
  unit = u;
  записать(KEY, u);
  subs.forEach((f) => f());
}
function subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
export const subscribeUnit = subscribe; // не-React подписка (для моста)
// Хук: возвращает текущую единицу и перерисовывает компонент при её смене.
export function useUnit(): Unit { return useSyncExternalStore(subscribe, getUnit, getUnit); }

export function unitLabel(u: Unit = unit): string { return u === 'mgdl' ? 'мг/дл' : 'ммоль/л'; }

// число глюкозы в текущих единицах (для осей/порогов графиков)
export function gluValue(mmol: number, u: Unit = unit): number {
  return u === 'mgdl' ? Math.round(mmol * MGDL_PER_MMOL) : mmol;
}

export function fmt(v: number) { return v.toFixed(1).replace('.', ','); }

// строка глюкозы в текущих единицах (ммоль — с запятой, мг/дл — целое)
export function toUnits(mmol: number, u: Unit = unit): string {
  return u === 'mgdl' ? String(Math.round(mmol * MGDL_PER_MMOL)) : fmt(mmol);
}

// --- единицы углеводов: граммы ⇄ Х.Е. (хлебные единицы) ---
// Внутри всё храним и считаем в ГРАММАХ; Х.Е. — только способ показа/ввода.
export type CarbUnit = 'g' | 'xe';
export const XE_GRAMS = 12; // 1 Х.Е. = 12 г
const CKEY = 'sl.carbunits';

let carbUnit: CarbUnit = (прочитать(CKEY) as CarbUnit) || 'g';
const csubs = new Set<() => void>();

export function getCarbUnit(): CarbUnit { return carbUnit; }
export function setCarbUnit(u: CarbUnit) {
  if (u === carbUnit) return;
  carbUnit = u;
  записать(CKEY, u);
  csubs.forEach((f) => f());
}
function csubscribe(cb: () => void) { csubs.add(cb); return () => { csubs.delete(cb); }; }
export const subscribeCarbUnit = csubscribe; // не-React подписка (для моста)
export function useCarbUnit(): CarbUnit { return useSyncExternalStore(csubscribe, getCarbUnit, getCarbUnit); }

export function carbUnitLabel(u: CarbUnit = carbUnit): string { return u === 'xe' ? 'Х.Е.' : 'г'; }

// граммы → строка в текущих единицах углеводов (Х.Е. — с десятой, граммы — целое)
export function toCarbs(grams: number, u: CarbUnit = carbUnit): string {
  return u === 'xe' ? fmt(Math.round((grams / XE_GRAMS) * 10) / 10) : String(Math.round(grams));
}

export function agoText(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  return Math.floor(m / 60) + ' ч назад';
}

/* Длительность в днях → «1 д 18 ч». Дробные дни («≈ 1,8 дн») человеку приходится
   пересчитывать в уме, а решение принимается именно в часах: хватит ли до утра,
   доживу ли до замены. Часы округляем вниз: «осталось не меньше», а не наоборот. */
export function daysHoursText(days: number): string {
  const totalH = Math.max(0, Math.floor(days * 24));
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  if (d === 0) return h + ' ч';
  if (h === 0) return d + ' д';
  return d + ' д ' + h + ' ч';
}


/* Русские окончания по числу. Заводится один раз и на всё: «2 раз» вместо «2 раза»
   читается как недоделка, а таких мест в приложении уже несколько. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
