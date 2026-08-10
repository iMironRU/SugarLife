import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeCached, clearAnalysisCache } from './analysisCache';
import type { Entry } from './types';

/* Кэш результатов разбора. Проверяем не «работает вообще», а два свойства, ради
   которых он и заведён: повторный запрос не считает заново, а новые данные не
   отдают старые выводы. */

const мк = (n: number, шаг = 5 * 60e3): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + i * шаг, mmol: 7, mgdl: 126, dir: 'Flat' }));

describe('память разбора', () => {
  beforeEach(clearAnalysisCache);

  it('второй запрос с теми же данными отдаёт тот же объект — счёта не было', () => {
    const e = мк(500);
    expect(analyzeCached(e, [], 14)).toBe(analyzeCached(e, [], 14));
  });

  it('разные периоды не путаются между собой', () => {
    const e = мк(500);
    expect(analyzeCached(e, [], 7)).not.toBe(analyzeCached(e, [], 14));
  });

  it('точка раз в минуту НЕ вызывает пересчёт — иначе кэш не работал бы вовсе', () => {
    /* Сенсор пишет ровно раз в минуту. При минутной гранулярности ключ менялся при
       каждом приходе данных, и разбор считался заново каждую минуту. */
    const e = мк(500);
    const через5мин = [...e, { t: e[e.length - 1].t + 5 * 60e3, mmol: 7, mgdl: 126, dir: 'Flat' } as Entry];
    expect(analyzeCached(через5мин, [], 14)).toBe(analyzeCached(e, [], 14));
  });

  it('через час пересчитывает: возраст расходников успевает сдвинуться', () => {
    const e = мк(500);
    const черезЧас = [...e, { t: e[e.length - 1].t + 3600e3 + 1000, mmol: 7, mgdl: 126, dir: 'Flat' } as Entry];
    expect(analyzeCached(черезЧас, [], 14)).not.toBe(analyzeCached(e, [], 14));
  });

  it('заряд телефона живой: его изменение обновляет разбор сразу', () => {
    const e = мк(500);
    expect(analyzeCached(e, [], 14, { uploaderBattery: 80 }))
      .not.toBe(analyzeCached(e, [], 14, { uploaderBattery: 15 }));
  });

  it('сброс освобождает память: после него объект уже другой', () => {
    const e = мк(500);
    const первый = analyzeCached(e, [], 14);
    clearAnalysisCache();
    expect(analyzeCached(e, [], 14)).not.toBe(первый);
  });

  it('кэш не растёт бесконечно — старое вытесняется', () => {
    const e = мк(200);
    const первый = analyzeCached(e, [], 3);
    for (const d of [7, 14, 30, 60, 90, 120]) analyzeCached(e, [], d);
    expect(analyzeCached(e, [], 3)).not.toBe(первый); // вытеснен, посчитан заново
  });
});
