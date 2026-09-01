import { sendIntent } from '@/sources/bridge';
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
  отдатьЕдиницыДвижку();
}

/* ЕДИНИЦЫ УХОДЯТ ДВИЖКУ (#674).

   Переключатель ммоль/л ⇄ мг/дл наш, а числа в снимке форматирует ДВИЖОК: он присылает готовое
   «7,8 ммоль/л». Пока обе стороны по умолчанию в ммоль, расхождения не видно — но человек,
   переключивший единицы, увидел бы на одном экране обе системы сразу.

   Ошибка проявилась бы не у нас в разборе, а у него на глазах, и выглядела бы как поломка. Нашла
   это узкая проверка «настройки, которые движок принимает, а мы не пишем».

   Досылается при старте: переключить единицы могли давно, а движку об этом не говорили ни разу. */
export function отдатьЕдиницыДвижку(): void {
  void sendIntent({ type: 'setConfig', patch: { 'glucose.units': unit === 'mgdl' ? 'mgdl' : 'mmol' } });
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

/* МИНУС НУЛЯ НЕ БЫВАЕТ (#517). Поймано на эмуляторе: в круге и на тревожной полосе стояло
   «инс. −0,0 ед». Приходит это из расчёта, где остаток инсулина ушёл в микроскопический минус
   (−0.004), и `toFixed` честно печатает «-0.0». Человеку такое число говорит, что приложение
   сломано, — и он прав в том, что верить ему нельзя.

   Округляем ДО форматирования и убираем знак у нуля: «0,0» и «−0,0» — одно и то же число,
   и второе написание не несёт ничего, кроме тревоги. */
export function fmt(v: number) {
  const округлённое = Math.round(v * 10) / 10;
  return (Object.is(округлённое, -0) ? 0 : округлённое).toFixed(1).replace('.', ',');
}

// строка глюкозы в текущих единицах (ммоль — с запятой, мг/дл — целое)
export function toUnits(mmol: number, u: Unit = unit): string {
  return u === 'mgdl' ? String(Math.round(mmol * MGDL_PER_MMOL)) : fmt(mmol);
}

/* РАЗНИЦА СО ЗНАКОМ (#698). Дельта отвечает на «куда идёт», и знак в ней — половина ответа:
   «0,3» и «−0,3» это подъём и падение, а не одно число в разном оформлении.

   Ноль пишем БЕЗ знака: «+0,0» обещает подъём, которого нет. Правило то же, что у `fmt`, — минуса
   у нуля не бывает (#517), только здесь пропадает и плюс.

   Минус — типографский (−), а не дефис: в столбце цифр дефис читается как перенос. */
export function toUnitsDelta(mmol: number, u: Unit = unit): string {
  const v = u === 'mgdl' ? Math.round(mmol * MGDL_PER_MMOL) : Math.round(mmol * 10) / 10;
  if (v === 0) return u === 'mgdl' ? '0' : '0,0';
  const тело = u === 'mgdl' ? String(Math.abs(v)) : Math.abs(v).toFixed(1).replace('.', ',');
  return (v > 0 ? '+' : '−') + тело;
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
export function useCarbUnit(): CarbUnit { return useSyncExternalStore(csubscribe, getCarbUnit, getCarbUnit); }

export function carbUnitLabel(u: CarbUnit = carbUnit): string { return u === 'xe' ? 'Х.Е.' : 'г'; }

// граммы → строка в текущих единицах углеводов (Х.Е. — с десятой, граммы — целое)
export function toCarbs(grams: number, u: CarbUnit = carbUnit): string {
  return u === 'xe' ? fmt(Math.round((grams / XE_GRAMS) * 10) / 10) : String(Math.round(grams));
}

/* «Сколько назад» и «дни и часы» уехали в слова/время.ts (#408): это формулировки, а не
   счёт. Здесь остаются единицы измерения — они настройка человека и конвертация, а не
   слова. */


/* Русские окончания по числу. Заводится один раз и на всё: «2 раз» вместо «2 раза»
   читается как недоделка, а таких мест в приложении уже несколько. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
