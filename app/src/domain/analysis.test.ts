import { describe, it, expect } from 'vitest';
import { analyze } from './analysis';
import type { Entry, Treatment } from './types';

/* Разбор данных. Код написан давно, но ни разу не выполнялся — его даже не
   отрисовывали. Прежде чем показывать человеку выводы про его гипо и канюлю,
   надо убедиться, что он не падает на пустоте и не выдумывает находок там,
   где данных нет. */

const сейчас = Date.now(), ч = 3600e3, д = 24 * ч;
const мк = (n: number, знач: (i: number) => number, отступ = 0): Entry[] =>
  Array.from({ length: n }, (_, i) => ({
    t: сейчас - отступ - (n - 1 - i) * 5 * 60e3,
    mmol: знач(i), mgdl: знач(i) * 18, dir: 'Flat',
  }));
const событие = (type: string, назад: number, extra: Partial<Treatment> = {}): Treatment =>
  ({ t: сейчас - назад, type, carbs: null, insulin: null, rate: null, duration: null, ...extra }) as Treatment;

describe('разбор на пустоте', () => {
  it('без единого измерения не падает и не сочиняет находок про гликемию', () => {
    const a = analyze([], [], 14);
    expect(a.insights.every((i) => i.kind !== 'glucose')).toBe(true);
    expect(Number.isFinite(a.coverage)).toBe(true);
  });

  it('без событий не сочиняет находок про расходники', () => {
    const a = analyze(мк(288, () => 7), [], 14);
    expect(a.insights.every((i) => i.kind !== 'device')).toBe(true);
  });

  it('одно измерение не ломает расчёт', () => {
    expect(() => analyze(мк(1, () => 7), [], 14)).not.toThrow();
  });

  it('окно в один день не ломает расчёт', () => {
    expect(() => analyze(мк(288, () => 7), [событие('Site Change', 2 * д)], 1)).not.toThrow();
  });
});

describe('находки появляются только по делу', () => {
  it('старая канюля отмечается, свежая — нет', () => {
    const старая = analyze([], [событие('Site Change', 5 * д)], 14);
    const свежая = analyze([], [событие('Site Change', 1 * ч)], 14);
    expect(старая.insights.some((i) => i.id === 'site')).toBe(true);
    expect(свежая.insights.some((i) => i.id === 'site')).toBe(false);
  });

  it('ночные гипо считаются только ночью', () => {
    // ровное 3.0 круглые сутки — гипо есть и ночью
    const ночью = analyze(мк(288 * 3, () => 3.0), [], 3);
    expect(ночью.insights.some((i) => i.id === 'night-hypo')).toBe(true);
  });

  it('на ровном сахаре в диапазоне тревожных находок про гликемию нет', () => {
    const a = analyze(мк(288 * 14, () => 6.5), [], 14);
    const тревожные = a.insights.filter((i) => i.kind === 'glucose' && (i.severity === 'bad' || i.severity === 'warn'));
    expect(тревожные.map((i) => i.id)).toEqual([]);
  });
});

describe('готовность к разбору', () => {
  it('без учёта углеводов честно говорит, что разбирать нечем', () => {
    const a = analyze(мк(288 * 14, () => 7), [], 14);
    expect(a.readiness.level).toBe('not');
    expect(a.readiness.reasons.join(' ')).toMatch(/углевод/i);
  });

  it('короткая история — «частично», а не «готово»', () => {
    const еда = Array.from({ length: 30 }, (_, i) => событие('Meal Bolus', i * ч, { carbs: 40 }));
    expect(analyze(мк(288 * 3, () => 7), еда, 3).readiness.level).not.toBe('ready');
  });

  it('причины не дублируются', () => {
    const r = analyze([], [], 14).readiness.reasons;
    expect(new Set(r).size).toBe(r.length);
  });
});

describe('порядок и целостность', () => {
  it('находки отсортированы по важности: тревожное выше спокойного', () => {
    const порядок = { bad: 0, warn: 1, info: 2, good: 3 } as const;
    const a = analyze(мк(288 * 14, (i) => (i % 500 === 0 ? 2.5 : 15)), [событие('Site Change', 6 * д)], 14);
    const ранги = a.insights.map((i) => порядок[i.severity]);
    expect([...ранги].sort((x, y) => x - y)).toEqual(ранги);
  });

  /* Слова каждой находки проверяются в слое показа (показ/находки.test.ts): здесь их
     больше нет, и это главное следствие разделения — правило проверяется, не сверяя букв. */
  it('у находки есть вид, по которому её называют', () => {
    const a = analyze(мк(288 * 14, (i) => (i % 300 === 0 ? 3 : 12)), [событие('Site Change', 5 * д)], 14);
    expect(a.insights.length).toBeGreaterThan(0);
    for (const i of a.insights) expect(i.вид).toBeTruthy();
  });
});
