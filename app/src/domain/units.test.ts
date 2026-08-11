import { describe, it, expect } from 'vitest';
import {
  gluValue, toUnits, fmt, unitLabel, toCarbs, carbUnitLabel, XE_GRAMS,
  agoText, daysHoursText, plural,
} from './units';
import { MGDL_PER_MMOL } from './types';

/* Единицы измерения. Модуль маленький, но ошибка здесь портит сахар СРАЗУ на всех
   экранах — в панели, метриках, аналитике и в подсказках. Единственный кусок
   арифметики, который я при первом заходе оставил без тестов. */

describe('глюкоза', () => {
  it('в ммоль/л значение не трогается — перевод «в себя» не должен округлять', () => {
    expect(gluValue(5.55, 'mmol')).toBe(5.55);
  });

  it('в мг/дл переводится по единой константе и округляется до целого', () => {
    expect(gluValue(5.5, 'mgdl')).toBe(Math.round(5.5 * MGDL_PER_MMOL));
    expect(gluValue(10, 'mgdl')).toBe(180);
  });

  it('перевод туда-обратно не уводит значение дальше половины деления', () => {
    for (const mmol of [3.0, 3.9, 5.5, 7.8, 10.0, 13.9, 22.2]) {
      const обратно = gluValue(mmol, 'mgdl') / MGDL_PER_MMOL;
      expect(Math.abs(обратно - mmol)).toBeLessThan(0.05);
    }
  });

  it('в тексте ммоль/л идут с десятой и запятой, мг/дл — целыми', () => {
    expect(toUnits(5.5, 'mmol')).toBe('5,5');
    expect(toUnits(5.5, 'mgdl')).toBe('99');
  });

  it('запятая, а не точка: русский десятичный разделитель', () => {
    expect(fmt(7.25)).toBe('7,3');
    expect(fmt(7)).toBe('7,0');
  });

  it('подписи единиц не перепутаны', () => {
    expect(unitLabel('mmol')).toBe('ммоль/л');
    expect(unitLabel('mgdl')).toBe('мг/дл');
  });

  it('ноль остаётся нулём, а не превращается в прочерк', () => {
    expect(toUnits(0, 'mmol')).toBe('0,0');
    expect(gluValue(0, 'mgdl')).toBe(0);
  });
});

describe('углеводы', () => {
  it('граммы показываются целыми', () => {
    expect(toCarbs(45.4, 'g')).toBe('45');
  });

  it('хлебные единицы считаются по 12 г и показываются с десятой', () => {
    expect(toCarbs(XE_GRAMS, 'xe')).toBe('1,0');
    expect(toCarbs(XE_GRAMS * 2.5, 'xe')).toBe('2,5');
  });

  it('подписи не перепутаны', () => {
    expect(carbUnitLabel('g')).toBe('г');
    expect(carbUnitLabel('xe')).toBe('Х.Е.');
  });
});

describe('время', () => {
  const сейчас = Date.now();

  it('свежесть: минуты, потом часы', () => {
    expect(agoText(сейчас - 30e3, сейчас)).toMatch(/только что|сек|мин/);
    expect(agoText(сейчас - 5 * 60e3, сейчас)).toMatch(/5/);
    expect(agoText(сейчас - 3 * 3600e3, сейчас)).toMatch(/ч/);
  });

  it('остаток инсулина: дни и часы, а не десятичный хвост', () => {
    /* Просили именно так: «1 д 18 ч» вместо «1,75 дн» — часы из десятичной дроби
       человек в уме не считает. */
    expect(daysHoursText(1.75)).toMatch(/1\s*д/);
    expect(daysHoursText(1.75)).toMatch(/18\s*ч/);
  });

  it('меньше суток — только часы', () => {
    expect(daysHoursText(0.5)).not.toMatch(/д/);
    expect(daysHoursText(0.5)).toMatch(/12\s*ч/);
  });
});

describe('русские окончания по числу', () => {
  const раз = (n: number) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`;
  it('один — раз, два-четыре — раза, пять и дальше — раз', () => {
    expect(раз(1)).toBe('1 раз');
    expect(раз(2)).toBe('2 раза');
    expect(раз(5)).toBe('5 раз');
  });
  it('подростковые числа — исключение: 11–14 всегда «раз»', () => {
    expect(раз(11)).toBe('11 раз');
    expect(раз(12)).toBe('12 раз');
    expect(раз(14)).toBe('14 раз');
  });
  it('десятки считаются по последней цифре', () => {
    expect(раз(21)).toBe('21 раз');
    expect(раз(22)).toBe('22 раза');
    expect(раз(25)).toBe('25 раз');
    expect(раз(101)).toBe('101 раз');
  });
});
