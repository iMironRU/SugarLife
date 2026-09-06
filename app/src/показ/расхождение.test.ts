import { describe, it, expect } from 'vitest';
import { расхождение, приборРазошёлся } from './расхождение';
import type { UiSnapshot } from '@/sources/bridge';

const снимок = (o: Partial<UiSnapshot>): UiSnapshot => ({
  devices: [
    { id: 'a', name: 'Sibionics GS1', latestGlucoseMmol: 8.6 },
    { id: 'b', name: 'Dexcom G7', latestGlucoseMmol: 4.5 },
    { id: 'c', name: 'Помпа' },
  ],
  ...o,
} as unknown as UiSnapshot);

const див = (o: Record<string, unknown> = {}) =>
  ({ mmol: 4.1, text: 'Приборы расходятся на 4,1 ммоль. Как минимум один ошибается — проверьте глюкометром, какой ближе.', deviceIds: ['a', 'b'], ...o });

describe('приборы расходятся', () => {
  it('нет поля — молчим, не рассуждая', () => {
    /* Решение, говорить ли, принимает движок: два сенсора расходятся всегда, и почти всё
       это расхождение — норма. Своего порога у нас нет и быть не должно. */
    expect(расхождение(снимок({}))).toBeNull();
    expect(расхождение(null)).toBeNull();
  });

  it('фразу берём как есть — своей не пишем', () => {
    const р = расхождение(снимок({ divergence: див() } as never))!;
    expect(р.текст).toBe(див().text);
  });

  it('рядом с фразой — числа обоих приборов: иначе совет невыполним', () => {
    const р = расхождение(снимок({ divergence: див() } as never))!;
    expect(р.приборы).toEqual([
      { id: 'a', имя: 'Sibionics GS1', число: '8,6' },
      { id: 'b', имя: 'Dexcom G7', число: '4,5' },
    ]);
  });

  it('прибор без числа в список не попадает: «—» читалось бы как его поломка', () => {
    const р = расхождение(снимок({ divergence: див({ deviceIds: ['a', 'c'] }) } as never))!;
    expect(р.приборы.map((п) => п.id)).toEqual(['a']);
  });

  it('приборы не нашлись — остаётся фраза, а не пустая строка', () => {
    const р = расхождение(снимок({ divergence: див({ deviceIds: ['нет-такого'] }) } as never))!;
    expect(р.текст).toBeTruthy();
    expect(р.приборы).toEqual([]);
  });

  it('подсвечиваем ровно названные карточки, а не все', () => {
    const с = снимок({ divergence: див() } as never);
    expect(приборРазошёлся(с, 'a')).toBe(true);
    expect(приборРазошёлся(с, 'c')).toBe(false);
    expect(приборРазошёлся(снимок({}), 'a')).toBe(false);
  });
});
