import { describe, it, expect } from 'vitest';
import { loopValue, activeInsulin, СВЕЖЕСТЬ_ЦИКЛА_МС } from './loopValue';
import type { Device } from './types';

/* «Нет инсулина» и «неизвестно, сколько инсулина» — разные состояния. Тут проверяется
   ровно эта граница: ноль должен оставаться нулём, а молчащий цикл — неизвестностью. */

const МИН = 60e3;
const now = Date.UTC(2026, 7, 11, 12, 0, 0);
const dev = (iob: number | null, loopAt: number | null): Device => ({
  iob, cob: null, reservoir: 75, pumpBattery: 75, status: 'Замкнутый цикл',
  baseBasal: null, tempRate: null, tempRemaining: null, lastBolus: null,
  uploaderBattery: 63, loop: true, pump: true, at: now, loopAt,
  mountBattery: null, suspended: false,
});

describe('известно / неизвестно у показателей цикла', () => {
  it('ноль — это ноль, а не «нет данных»', () => {
    const r = activeInsulin(dev(0, now - 2 * МИН), now);
    expect(r.known).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('свежий расчёт — верим', () => {
    expect(activeInsulin(dev(4.1, now - 5 * МИН), now).known).toBe(true);
  });

  it('молчащий цикл — не верим и говорим, сколько молчит', () => {
    const r = activeInsulin(dev(4.1, now - 40 * МИН), now);
    expect(r.known).toBe(false);
    expect(r.reason).toBe('цикл молчит 40 мин');
  });

  it('расчёта не было вовсе — тоже неизвестно', () => {
    const r = activeInsulin(dev(null, null), now);
    expect(r.known).toBe(false);
    expect(r.reason).toBe('цикл не присылал расчёт');
  });

  it('устройства нет — неизвестно, а не ноль', () => {
    expect(activeInsulin(null, now).known).toBe(false);
  });

  it('граница порога: ровно на нём ещё верим, за ним уже нет', () => {
    expect(loopValue(1, now - СВЕЖЕСТЬ_ЦИКЛА_МС, now).known).toBe(true);
    expect(loopValue(1, now - СВЕЖЕСТЬ_ЦИКЛА_МС - 1, now).known).toBe(false);
  });

  it('срок молчания читается по-человечески', () => {
    expect(loopValue(1, now - 3 * 3600e3, now).reason).toBe('цикл молчит 3 ч');
    expect(loopValue(1, now - 50 * 3600e3, now).reason).toBe('цикл молчит 2 д');
  });
});
