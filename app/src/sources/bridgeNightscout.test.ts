import { describe, it, expect } from 'vitest';
import { _sourceStatusOf as статус } from './bridgeNightscout';

/* Статус источника у Nightscout-шима (SugarLife#358).

   С телефона: круг показывает часики и «догоняю…», а строкой ниже список показаний,
   верхнему из которых минута. Причина была здесь: статус считался по наличию СОКЕТА, а
   не по свежести данных. Сокет рвётся штатно — например, когда приложение уходит в фон
   и возвращается, — а опрос продолжает приносить показания.

   Проверяем именно это: способ доставки не входит в вопрос «идут ли данные». */
const мин = 60_000;
const т = Date.now();

describe('статус источника', () => {
  it('данные свежие, сокета нет — всё равно Live', () => {
    expect(статус(false, 'ready', т - 1 * мин)).toBe('Live');
  });

  it('данные свежие и сокет есть — Live', () => {
    expect(статус(true, 'ready', т - 1 * мин)).toBe('Live');
  });

  /* Acquiring остаётся там, где означает своё: показаний нет ВОВСЕ. */
  it('показаний нет вовсе — Acquiring', () => {
    expect(статус(true, 'ready', null)).toBe('Acquiring');
  });

  it('показание старое — Delayed, независимо от сокета', () => {
    expect(статус(true, 'ready', т - 20 * мин)).toBe('Delayed');
    expect(статус(false, 'ready', т - 20 * мин)).toBe('Delayed');
  });

  it('стор говорит об обрыве — Delayed даже при свежем числе', () => {
    expect(статус(false, 'stale', т - 1 * мин)).toBe('Delayed');
    expect(статус(false, 'error', т - 1 * мин)).toBe('Delayed');
  });

  it('источника нет и загрузка — как было', () => {
    expect(статус(false, 'off', т)).toBe('Disconnected');
    expect(статус(false, 'idle', т)).toBe('Disconnected');
    expect(статус(false, 'loading', null)).toBe('Connecting');
  });
});
