/* Форматирование глюкозы/времени + глобальный выбор единиц (ммоль/л ⇄ мг/дл).
   Внимание: конвертируется ТОЛЬКО глюкоза. Инсулин/углеводы форматируются
   через fmt() и единицами не затрагиваются. */
import { useSyncExternalStore } from 'react';

export type Unit = 'mmol' | 'mgdl';
const MGDL_PER_MMOL = 18;
const KEY = 'sl.units';

let unit: Unit = (typeof localStorage !== 'undefined' && (localStorage.getItem(KEY) as Unit)) || 'mmol';
const subs = new Set<() => void>();

export function getUnit(): Unit { return unit; }
export function setUnit(u: Unit) {
  if (u === unit) return;
  unit = u;
  try { localStorage.setItem(KEY, u); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
function subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
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

export function agoText(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  return Math.floor(m / 60) + ' ч назад';
}
