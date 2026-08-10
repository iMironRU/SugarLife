/* Базальный профиль: модель для редактора (docs/prototypes/basal-profile.html).

   Интервал — это [a, b) в часах со скоростью v ЕД/ч. Nightscout отдаёт расписание
   точками «с какого часа», без конца; здесь превращаем в интервалы, потому что
   редактируют и считают именно их: доза за интервал, деление пополам, слияние.

   Шаг значения 0.05 ЕД/ч и границы кратно 30 минутам — это не наша выдумка, а то,
   что умеют помпы. Считать и показывать точнее, чем можно ввести в железку, значит
   обещать несуществующую точность. */
import type { BasalStep } from '@/domain/types';

export interface Seg { a: number; b: number; v: number }

export const STEP = 0.05;      // шаг скорости, ЕД/ч
export const MIN_RATE = 0.05;
export const MAX_RATE = 5;

export const PARTS = [
  { nm: 'Ночь', a: 0, b: 4 },
  { nm: 'Раннее утро', a: 4, b: 9 },
  { nm: 'День', a: 9, b: 17 },
  { nm: 'Вечер', a: 17, b: 24 },
];

export const fmtH = (h: number): string =>
  String(Math.floor(h)).padStart(2, '0') + ':' + (h % 1 ? '30' : '00');

export const roundRate = (v: number): number =>
  Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(v / STEP) * STEP));

/** Точки расписания → интервалы. Последний замыкается на полночь. */
export function toSegs(steps: BasalStep[]): Seg[] {
  if (!steps.length) return [];
  const s = [...steps].sort((x, y) => x.h - y.h);
  return s.map((x, i) => ({ a: x.h, b: i + 1 < s.length ? s[i + 1].h : 24, v: x.v }))
    .filter((x) => x.b > x.a);
}

export const rateAt = (segs: Seg[], h: number): number => segs.find((s) => h >= s.a && h < s.b)?.v ?? 0;
export const daily = (segs: Seg[]): number => segs.reduce((t, s) => t + (s.b - s.a) * s.v, 0);

/** Доза за часть суток — по получасам, чтобы не зависеть от границ интервалов. */
export function partDose(segs: Seg[], p: { a: number; b: number }): number {
  let t = 0;
  for (let h = p.a; h < p.b; h += 0.5) t += rateAt(segs, h) * 0.5;
  return t;
}
export const partAvg = (segs: Seg[], p: { a: number; b: number }): number => partDose(segs, p) / (p.b - p.a);

/** Интервалы, попадающие в часть суток (хотя бы частично). */
export const segsIn = (segs: Seg[], p: { a: number; b: number }) =>
  segs.map((s, i) => ({ s, i })).filter((x) => x.s.b > p.a && x.s.a < p.b);

export const sameProfile = (a: Seg[], b: Seg[]): boolean =>
  a.length === b.length && a.every((s, i) => s.a === b[i].a && s.b === b[i].b && Math.abs(s.v - b[i].v) < 1e-6);

/** Разделить интервал пополам с округлением середины до получаса. */
export function splitSeg(segs: Seg[], i: number): Seg[] {
  const s = segs[i];
  const m = s.a + Math.floor(((s.b - s.a) / 2) * 2) / 2;
  if (m <= s.a || m >= s.b) return segs;
  return [...segs.slice(0, i), { a: s.a, b: m, v: s.v }, { a: m, b: s.b, v: s.v }, ...segs.slice(i + 1)];
}

/** Слить со следующим — остаётся скорость текущего. */
export function mergeSeg(segs: Seg[], i: number): Seg[] {
  if (i >= segs.length - 1) return segs;
  return [...segs.slice(0, i), { a: segs[i].a, b: segs[i + 1].b, v: segs[i].v }, ...segs.slice(i + 2)];
}

export const scaleAll = (segs: Seg[], pct: number): Seg[] =>
  segs.map((s) => ({ ...s, v: roundRate(s.v * (1 + pct / 100)) }));

export const flatten = (segs: Seg[]): Seg[] => [{ a: 0, b: 24, v: roundRate(daily(segs) / 24) }];

/* --- Часовой пояс профиля ---

   Расписание базала размечено по времени ПОМПЫ, а приложение живёт по времени
   телефона. Пока они совпадают, разницы не видно; в поездке — интервал «Ночь
   00:00–04:00» на экране и на помпе перестают быть одним и тем же, и правка уходит
   не туда. Молча пересчитывать в местное тоже нельзя: значения потом вводят на
   помпе, глядя на её часы, и переносить надо ровно те интервалы, что она покажет.

   Поэтому время оставляем помповым, а расхождение показываем явно. */

/** Смещение пояса от UTC в минутах на заданный момент (с учётом перехода на летнее время). */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number | null {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p: Record<string, string> = {};
    for (const part of f.formatToParts(at)) p[part.type] = part.value;
    const h = p.hour === '24' ? 0 : +p.hour; // Intl отдаёт 24 вместо 00 для полуночи
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
    return Math.round((asUTC - at.getTime() / 1000 * 1000) / 60000);
  } catch {
    return null; // незнакомый пояс — молчим, а не рисуем неверную разницу
  }
}

/** На сколько минут время профиля впереди времени телефона (0 — совпадают). */
export function tzShiftMinutes(profileTz: string | undefined, at: Date = new Date()): number {
  if (!profileTz) return 0;
  const свой = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!свой || свой === profileTz) return 0;
  const a = tzOffsetMinutes(profileTz, at), b = tzOffsetMinutes(свой, at);
  return a == null || b == null ? 0 : a - b;
}

/** «на 2 ч вперёд» / «на 1 ч 30 мин назад» — для подписи, а не для расчёта. */
export function tzShiftText(min: number): string {
  const знак = min > 0 ? 'вперёд' : 'назад';
  const m = Math.abs(min), ч = Math.floor(m / 60), мм = m % 60;
  const части = [ч ? `${ч} ч` : '', мм ? `${мм} мин` : ''].filter(Boolean).join(' ');
  return `на ${части} ${знак}`;
}
