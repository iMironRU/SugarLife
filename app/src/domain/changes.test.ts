import { describe, it, expect } from 'vitest';
import { deviceAges } from './treatmentStats';
import type { Treatment } from './types';

/* Возраст расходника при отметке «Поменял».

   Проверяем именно правило разрешения, потому что оно неочевидно и оба перекоса вредны:
   «отметка всегда важнее» затрёт более свежее событие из AAPS, «событие всегда важнее»
   вернёт нас к исходной болезни — замена без события не видна вовсе. */

const ЧАС = 3600e3;
const сейчас = Date.now();
const событие = (t: number, type: string): Treatment => ({ t, type } as Treatment);

describe('возраст расходников с отметками', () => {
  it('события нет вовсе — возраст берётся из отметки', () => {
    // ровно случай 27.07: картридж поменяли, AAPS не зарегистрировал ничего
    const a = deviceAges([], { reservoir: сейчас - 5 * ЧАС });
    expect(a.reservoir?.hours).toBe(5);
  });

  it('отметка свежее события — берём отметку', () => {
    const a = deviceAges([событие(сейчас - 48 * ЧАС, 'Insulin Change')], { reservoir: сейчас - 2 * ЧАС });
    expect(a.reservoir?.hours).toBe(2);
  });

  it('событие свежее отметки — берём событие', () => {
    // человек отметил у нас, а потом залогировал и в AAPS: событие ближе к правде
    const a = deviceAges([событие(сейчас - ЧАС, 'Insulin Change')], { reservoir: сейчас - 6 * ЧАС });
    expect(a.reservoir?.hours).toBe(1);
  });

  it('без отметок ведёт себя как раньше', () => {
    const a = deviceAges([событие(сейчас - 3 * ЧАС, 'Site Change')]);
    expect(a.site?.hours).toBe(3);
    expect(a.reservoir).toBeNull();
  });

  it('отметки не путаются между расходниками', () => {
    const a = deviceAges([], { site: сейчас - ЧАС });
    expect(a.site?.hours).toBe(1);
    expect(a.reservoir).toBeNull();
    expect(a.sensor).toBeNull();
    expect(a.battery).toBeNull();
  });

  it('ничего не известно — ничего и не показываем', () => {
    const a = deviceAges([], {});
    expect(a.site).toBeNull();
    expect(a.sensor).toBeNull();
  });
});
