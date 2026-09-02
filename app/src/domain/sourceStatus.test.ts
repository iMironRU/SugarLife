import { describe, it, expect } from 'vitest';
import { sourceStatusWarn } from './sourceStatus';

/* Слова статуса уехали в `слова/приборы.test.ts` (#324). Здесь осталось суждение: тревожный
   статус или нет, — оно про поведение экрана, а не про буквы. */
describe('статус источника данных', () => {
  it('«отстаёт» и «нет связи» — тревожные, остальное нет', () => {
    expect(sourceStatusWarn('Delayed')).toBe(true);
    expect(sourceStatusWarn('Disconnected')).toBe(true);
    expect(sourceStatusWarn('Live')).toBe(false);
    expect(sourceStatusWarn('Connecting')).toBe(false);
  });

  /* «Связь есть, показаний ещё нет» — норма, а не беда: тревожный вид у нормального состояния
     обесценивает тревожный вид вообще. */
  it('прогрев не тревога', () => {
    expect(sourceStatusWarn('Acquiring')).toBe(false);
  });

  it('поля нет — и суждения нет', () => {
    expect(sourceStatusWarn(undefined)).toBe(false);
  });
});
