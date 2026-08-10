import { describe, it, expect } from 'vitest';
import { stats, LOW, HIGH, VLOW, VHIGH } from './agp';
import type { Entry } from '@/domain/types';

/* Показатели гликемии — то, на что человек смотрит, оценивая, стало ли лучше.
   Проверяем свойства, а не конкретные числа: сумма зон равна 100 %, границы зон
   не пересекаются и не оставляют щелей, GMI растёт вместе со средним. */

const мк = (...vals: number[]): Entry[] => vals.map((mmol, i) => ({ t: i * 300000, mmol, dir: 'Flat' } as Entry));

describe('статистика гликемии', () => {
  it('нет данных — нет и статистики: ноль честнее выдуманного нуля', () => {
    expect(stats([])).toBeNull();
  });

  it('зоны в сумме дают ровно 100 %', () => {
    const s = stats(мк(2.5, 3.5, 5, 7, 9.9, 11, 15, 20))!;
    expect(s.veryLow + s.low + s.target + s.high + s.veryHigh).toBeCloseTo(100, 9);
  });

  it('границы зон не пересекаются и не оставляют щелей', () => {
    // ровно на границах: VLOW=3.0, LOW=3.9, HIGH=10.0, VHIGH=13.9
    const s = stats(мк(VLOW, LOW, HIGH, VHIGH))!;
    expect(s.veryLow).toBe(0);            // 3.0 уже не «очень низко»
    expect(s.low).toBeCloseTo(25, 9);     // 3.0 попал в «низко»
    expect(s.target).toBeCloseTo(50, 9);  // 3.9 и 10.0 — в диапазоне
    expect(s.high).toBeCloseTo(25, 9);    // 13.9 — «высоко», не «очень»
    expect(s.veryHigh).toBe(0);
  });

  it('время ниже и выше цели — это суммы соответствующих зон', () => {
    const s = stats(мк(2, 3.5, 5, 12, 18))!;
    expect(s.tbr).toBeCloseTo(s.veryLow + s.low, 9);
    expect(s.tar).toBeCloseTo(s.high + s.veryHigh, 9);
  });

  it('на ровных данных разброс нулевой', () => {
    const s = stats(мк(7, 7, 7, 7))!;
    expect(s.sd).toBe(0);
    expect(s.cv).toBe(0);
    expect(s.mean).toBe(7);
  });

  it('GMI растёт вместе со средним сахаром', () => {
    expect(stats(мк(10, 10))!.gmi).toBeGreaterThan(stats(мк(6, 6))!.gmi);
  });

  it('единственное измерение не ломает расчёт', () => {
    const s = stats(мк(5.5))!;
    expect(s.n).toBe(1);
    expect(s.target).toBe(100);
    expect(s.sd).toBe(0);
  });
});
