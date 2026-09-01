import { describe, it, expect } from 'vitest';
import { deviceAges, insulinDaily, carbStats, reservoirStats } from './treatmentStats';
import type { Treatment } from '@/domain/types';

/* Расходники и суточные дозы. Эти числа человек видит как «канюля 3 дня» и
   «инсулина 28 ЕД» — по ним принимают решение менять набор и оценивать терапию. */

const ч = 3600e3, д = 24 * ч;
const событие = (type: string, назад: number, extra: Partial<Treatment> = {}): Treatment =>
  ({ t: Date.now() - назад, type, carbs: null, insulin: null, rate: null, duration: null, ...extra }) as Treatment;

describe('возраст расходников', () => {
  it('берёт последнюю замену, а не первую: важно, сколько носится сейчас', () => {
    const ages = deviceAges([событие('Site Change', 5 * д), событие('Site Change', 2 * д)]);
    expect(ages.site!.days).toBe(2);
  });

  it('часы — это всего часов, а не остаток сверх суток', () => {
    const ages = deviceAges([событие('Site Change', 2 * д + 3 * ч)]);
    expect(ages.site!.days).toBe(2);
    expect(ages.site!.hours).toBe(51); // 2×24 + 3, а не 3
  });

  it('нет события — нет и возраста: прочерк честнее нуля', () => {
    expect(deviceAges([]).site).toBeNull();
  });

  it('разные расходники считаются независимо', () => {
    const ages = deviceAges([
      событие('Site Change', 3 * д),
      событие('Insulin Change', 1 * д),
      событие('Pump Battery Change', 10 * д),
      событие('Sensor Change', 8 * д),
    ]);
    expect([ages.site!.days, ages.reservoir!.days, ages.battery!.days, ages.sensor!.days]).toEqual([3, 1, 10, 8]);
  });

  it('замена сенсора распознаётся и по Sensor Start', () => {
    expect(deviceAges([событие('Sensor Start', 1 * д)]).sensor!.days).toBe(1);
  });
});

describe('суточный инсулин', () => {
  it('суточная доза — это сумма базала и болюсов за день', () => {
    const базал = [событие('Temp Basal', 2 * ч, { rate: 1, duration: 60 })];
    const болюс = [событие('Bolus', 1 * ч, { insulin: 5 })];
    const d = insulinDaily(базал, болюс);
    expect(d.tddPerDay).toBeCloseTo(d.basalPerDay + d.bolusPerDay, 6);
  });

  it('день с неполным покрытием базала в среднее не берётся', () => {
    /* Иначе день, где мост молчал 20 часов, занижал бы суточную дозу и человек
       решил бы, что стал колоть меньше. Здесь покрытия нет совсем. */
    const d = insulinDaily([событие('Temp Basal', 2 * ч, { rate: 1, duration: 30 })], []);
    expect(d.coveredDays).toBe(0);
    expect(d.tddPerDay).toBe(0);
  });

  it('пустой день не даёт NaN', () => {
    const d = insulinDaily([], []);
    expect(Number.isFinite(d.tddPerDay)).toBe(true);
  });
});

describe('углеводы', () => {
  it('без записей еды честно сообщает, что данных нет', () => {
    expect(carbStats([], 14).hasData).toBe(false);
  });

  it('среднее за приём — по приёмам, а приёмы — за день', () => {
    /* Величина «в день», а не «всего»: два приёма за две недели дают 0 в день.
       Раньше поле называлось mealCount и подписывалось «Приёмов пищи» — читалось
       как итог за период. Переименовано в mealsPerDay, подпись «Приёмов в день». */
    const s = carbStats([событие('Meal Bolus', 1 * д, { carbs: 30 }), событие('Meal Bolus', 2 * д, { carbs: 50 })], 14);
    expect(s.avgPerMeal).toBeCloseTo(40, 6);
    expect(s.mealsPerDay).toBe(0);
    expect(carbStats([событие('Meal Bolus', 2 * ч, { carbs: 30 }), событие('Meal Bolus', 3 * ч, { carbs: 50 })], 1).mealsPerDay).toBe(2);
  });
});

describe('резервуар', () => {
  const ч = 3600e3;

  it('пустой ряд не ломает расчёт', () => {
    expect(() => reservoirStats([])).not.toThrow();
    expect(reservoirStats([])).toEqual({ current: null, flatHours: 0 });
  });

  /* Ряд хранится краями плато: середины в нём нет и не нужно. «Стоит» считается от последней
     СМЕНЫ значения до последнего наблюдения. */
  it('залипание считается от последней смены значения', () => {
    const s = reservoirStats([
      { t: 0, v: 120 }, { t: 5 * ч, v: 120 },
      { t: 6 * ч, v: 110 }, { t: 15 * ч, v: 110 },
    ]);
    expect(s.current).toBe(110);
    expect(s.flatHours).toBeCloseTo(9, 6);
  });

  /* Подача идёт — остаток убывает, и залипания нет: девять часов на одном значении и девять
     часов ровного расхода это разные вещи, а флаг у них был бы один. */
  it('меняющийся остаток не залипает', () => {
    const s = reservoirStats([
      { t: 0, v: 120 }, { t: 3 * ч, v: 110 }, { t: 6 * ч, v: 100 }, { t: 9 * ч, v: 90 },
    ]);
    expect(s.current).toBe(90);
    expect(s.flatHours).toBeCloseTo(0, 6);
  });

  /* Одна точка — это ещё не история: сказать «стоит» по единственному наблюдению нельзя.
     Ровно так копилка выглядит первые минуты после установки. */
  it('одна точка даёт остаток, но не залипание', () => {
    expect(reservoirStats([{ t: 7 * ч, v: 75 }])).toEqual({ current: 75, flatHours: 0 });
  });

  it('порядок точек значения не имеет', () => {
    const s = reservoirStats([{ t: 15 * ч, v: 110 }, { t: 0, v: 120 }, { t: 6 * ч, v: 110 }]);
    expect(s.current).toBe(110);
    expect(s.flatHours).toBeCloseTo(9, 6);
  });
});
