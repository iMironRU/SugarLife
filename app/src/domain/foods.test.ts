import { describe, it, expect } from 'vitest';
import { FOODS, searchFoods, personalFoods, CAT_ORDER } from './foods';
import { makeMeal } from './meals';

const ДЕНЬ = 86400e3;
const СЕЙЧАС = Date.UTC(2026, 7, 11, 12, 0, 0);
const приём = (днейНазад: number, carbs: number, kind: string) =>
  makeMeal({ t: СЕЙЧАС - днейНазад * ДЕНЬ, carbs, kind }, СЕЙЧАС, Math.random());

describe('справочник еды', () => {
  it('единица справочника — приём, а не только продукт', () => {
    const приёмы = FOODS.filter((f) => f.cat === 'meal');
    expect(приёмы.length).toBeGreaterThanOrEqual(9);
    expect(приёмы.some((f) => /плотный завтрак/i.test(f.name))).toBe(true);
  });

  it('купирование гипо есть и стоит близко к началу', () => {
    // в момент гипо листать некогда
    expect(CAT_ORDER.indexOf('hypo')).toBeLessThanOrEqual(1);
    const гипо = FOODS.filter((f) => f.cat === 'hypo');
    expect(гипо.length).toBeGreaterThanOrEqual(4);
    // по правилу пятнадцати — около 15 г быстрых углеводов
    for (const г of гипо) expect(г.carbs).toBeGreaterThanOrEqual(15);
  });

  it('есть еда на ноль углеводов — её тоже надо уметь внести', () => {
    expect(FOODS.some((f) => f.carbs === 0)).toBe(true);
  });

  it('идентификаторы уникальны', () => {
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
  });

  it('поиск по названию и по описанию порции', () => {
    expect(searchFoods('гречк').map((f) => f.id)).toEqual(['d-buck']);
    expect(searchFoods('таблетк').length).toBe(1);
    expect(searchFoods('').length).toBe(FOODS.length);
  });
});

describe('своё из истории', () => {
  it('близкие приёмы схлопываются в один: 54 и 56 г это тот же обед', () => {
    const p = personalFoods([приём(1, 54, 'Обед'), приём(2, 56, 'Обед')], {}, СЕЙЧАС);
    expect(p).toHaveLength(1);
    expect(p[0].count).toBe(2);
    expect(p[0].carbs).toBe(55);
  });

  it('частое выше редкого, даже если редкое свежее', () => {
    const p = personalFoods([
      приём(0, 20, 'Перекус'),
      приём(1, 40, 'Завтрак'), приём(2, 40, 'Завтрак'), приём(3, 40, 'Завтрак'),
    ], {}, СЕЙЧАС);
    expect(p[0].kind).toBe('Завтрак');
    expect(p[0].count).toBe(3);
  });

  it('разные типы приёма не смешиваются при одинаковых углеводах', () => {
    const p = personalFoods([приём(1, 40, 'Завтрак'), приём(1, 40, 'Ужин')], {}, СЕЙЧАС);
    expect(p).toHaveLength(2);
  });

  it('съеденное однажды год назад не всплывает', () => {
    expect(personalFoods([приём(200, 40, 'Обед')], {}, СЕЙЧАС)).toHaveLength(0);
  });

  it('приём без углеводов в список не идёт', () => {
    expect(personalFoods([приём(1, 0, 'Перекус')], {}, СЕЙЧАС)).toHaveLength(0);
  });

  it('имя подтягивается к группе, а не к отдельной записи', () => {
    const p = personalFoods([приём(1, 40, 'Завтрак'), приём(2, 42, 'Завтрак')], { 'Завтрак|40': 'Овсянка' }, СЕЙЧАС);
    expect(p[0].name).toBe('Овсянка');
    expect(p[0].count).toBe(2);
  });

  it('без имени поле пустое, а не выдуманное', () => {
    expect(personalFoods([приём(1, 40, 'Завтрак')], {}, СЕЙЧАС)[0].name).toBeUndefined();
  });

  it('пустая история — пустой список, без выдумок', () => {
    expect(personalFoods([], {}, СЕЙЧАС)).toEqual([]);
  });
});
