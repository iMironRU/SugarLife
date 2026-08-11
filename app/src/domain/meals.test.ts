import { describe, it, expect } from 'vitest';
import { makeMeal, sameMeal, onlyLocal, type Meal } from './meals';
import type { Treatment } from './types';

const МИН = 60e3;
const t0 = Date.UTC(2026, 7, 11, 13, 0, 0);
const еда = (t: number, carbs: number): Treatment => ({ t, type: 'Meal Bolus', carbs } as Treatment);

describe('запись приёма', () => {
  it('хранит граммы и время ЕДЫ, а не время внесения', () => {
    const съел = t0 - 30 * МИН;
    const m = makeMeal({ t: съел, carbs: 45 }, t0);
    expect(m.t).toBe(съел);        // от этого времени считаются активные углеводы
    expect(m.createdAt).toBe(t0);  // а это — когда человек дошёл до приложения
    expect(m.carbs).toBe(45);
  });

  it('новая запись не считается отправленной', () => {
    expect(makeMeal({ t: t0, carbs: 30 }).sync).toBe('local');
  });

  it('идентификатор стабилен по содержимому и уникален по соли', () => {
    const a = makeMeal({ t: t0, carbs: 30 }, t0, 0.1);
    const b = makeMeal({ t: t0, carbs: 30 }, t0, 0.9);
    expect(a.id).not.toBe(b.id);            // два разных приёма не склеятся
    expect(a.id).toContain(String(t0));     // но по ключу видно, о чём запись
  });
});

describe('склейка с облаком', () => {
  const m: Meal = makeMeal({ t: t0, carbs: 45 }, t0);

  it('тот же приём из облака узнаётся, несмотря на разъезд по секундам', () => {
    expect(sameMeal(m, еда(t0 + 90e3, 45))).toBe(true);
  });

  it('другое количество углеводов — другой приём', () => {
    expect(sameMeal(m, еда(t0, 46))).toBe(false);
  });

  it('тот же вес, но через час — другой приём', () => {
    expect(sameMeal(m, еда(t0 + 60 * МИН, 45))).toBe(false);
  });

  it('локальными остаются только те, которых в облаке нет', () => {
    const второй = makeMeal({ t: t0 + 120 * МИН, carbs: 20 }, t0);
    const свои = onlyLocal([m, второй], [еда(t0 + 30e3, 45)]);
    expect(свои.map((x) => x.carbs)).toEqual([20]);
  });

  it('болюс без углеводов за приём пищи не принимаем', () => {
    // коррекция без еды не должна «поглотить» внесённый приём
    expect(onlyLocal([m], [{ t: t0, type: 'Correction Bolus', insulin: 2 } as Treatment])).toHaveLength(1);
  });
});
