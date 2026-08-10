import { describe, it, expect } from 'vitest';
import {
  toSegs, daily, partDose, partAvg, PARTS, segsIn, splitSeg, mergeSeg,
  scaleAll, flatten, roundRate, sameProfile, rateAt, fmtH, MIN_RATE, MAX_RATE,
  tzOffsetMinutes, tzShiftMinutes, tzShiftText,
} from './basal';

/* Арифметика базального профиля. Это единственное место в приложении, где считаются
   дозы инсулина, и проверялась она до сих пор разовым скриптом, который нигде не
   сохранился. Здесь закреплены именно те свойства, нарушение которых даёт неверную
   дозу, а не текущие значения ради значений. */

const плоский = Array.from({ length: 24 }, (_, h) => ({ h, v: 1.2 })); // реальный профиль из Nightscout
const неровный = [{ h: 0, v: 0.6 }, { h: 3, v: 0.55 }, { h: 6, v: 0.75 }, { h: 10, v: 0.65 }];

describe('расписание → интервалы', () => {
  it('замыкает последний интервал на полночь, иначе часть суток потерялась бы', () => {
    const s = toSegs(неровный);
    expect(s[s.length - 1]).toEqual({ a: 10, b: 24, v: 0.65 });
  });

  it('сортирует по времени: Nightscout не обязан отдавать по порядку', () => {
    const s = toSegs([{ h: 6, v: 0.9 }, { h: 0, v: 0.5 }]);
    expect(s.map((x) => x.a)).toEqual([0, 6]);
  });

  it('принимает пустое расписание, не падая', () => {
    expect(toSegs([])).toEqual([]);
    expect(daily([])).toBe(0);
  });
});

describe('суточная доза', () => {
  it('24 часа по 1.2 дают 28.80 ЕД', () => {
    expect(daily(toSegs(плоский))).toBeCloseTo(28.8, 6);
  });

  it('сумма частей суток равна суточной: без нахлёстов и щелей', () => {
    for (const профиль of [плоский, неровный]) {
      const s = toSegs(профиль);
      const поЧастям = PARTS.reduce((t, p) => t + partDose(s, p), 0);
      expect(поЧастям).toBeCloseTo(daily(s), 6);
    }
  });

  it('средняя по части суток — это доза, делённая на её длину', () => {
    const s = toSegs(неровный);
    for (const p of PARTS) expect(partAvg(s, p)).toBeCloseTo(partDose(s, p) / (p.b - p.a), 6);
  });
});

describe('правка интервалов', () => {
  it('деление пополам сохраняет суточную дозу', () => {
    const s = toSegs(неровный);
    expect(daily(splitSeg(s, 0))).toBeCloseTo(daily(s), 6);
  });

  it('деление ставит границу на получас, а не в произвольную точку', () => {
    const s = [{ a: 0, b: 3, v: 0.6 }, { a: 3, b: 24, v: 0.7 }];
    expect(splitSeg(s, 0)[1].a % 0.5).toBe(0);
  });

  it('слияние берёт скорость текущего интервала и закрывает разрыв', () => {
    const s = toSegs(неровный);
    const m = mergeSeg(s, 0);
    expect(m[0]).toEqual({ a: 0, b: 6, v: 0.6 });
    expect(m.length).toBe(s.length - 1);
  });

  it('слияние последнего интервала невозможно — возвращает исходное', () => {
    const s = toSegs(неровный);
    expect(mergeSeg(s, s.length - 1)).toEqual(s);
  });
});

describe('инструменты профиля', () => {
  it('масштаб округляет к шагу помпы, а не даёт точность, которую не ввести', () => {
    const s = toSegs(неровный);
    for (const seg of scaleAll(s, 10)) {
      expect(Math.round(seg.v / 0.05)).toBeCloseTo(seg.v / 0.05, 6);
    }
  });

  it('выравнивание даёт один интервал и держит суточную в пределах округления', () => {
    const s = toSegs(неровный);
    const f = flatten(s);
    expect(f).toHaveLength(1);
    /* Точное сохранение дозы недостижимо и не нужно: средняя округляется к шагу
       помпы 0.05, и за 24 часа это даёт до 24 × 0.025 = 0.6 ЕД расхождения. Проверяем
       именно эту границу — она следует из шага, а не подогнана под текущий результат.
       Первая версия проверки требовала 0.05 и падала: ошибка была в оценке, не в коде. */
    expect(Math.abs(daily(f) - daily(s))).toBeLessThanOrEqual(24 * 0.05 / 2 + 1e-9);
  });
});

describe('границы скорости', () => {
  it('зажимает в пределы, которые принимает помпа', () => {
    expect(roundRate(0.001)).toBe(MIN_RATE);
    expect(roundRate(99)).toBe(MAX_RATE);
  });

  it('масштаб вниз не уводит в ноль: нулевой базал — это отдельное решение, а не побочный эффект', () => {
    const s = scaleAll([{ a: 0, b: 24, v: 0.05 }], -90);
    expect(s[0].v).toBe(MIN_RATE);
  });
});

describe('сравнение и выборка', () => {
  it('sameProfile ловит изменение значения, а не только структуры', () => {
    const a = toSegs(неровный);
    const b = a.map((s, i) => (i === 0 ? { ...s, v: s.v + 0.05 } : s));
    expect(sameProfile(a, a)).toBe(true);
    expect(sameProfile(a, b)).toBe(false);
  });

  it('в часть суток попадают интервалы, пересекающие её хотя бы частично', () => {
    const s = toSegs(неровный); // 0–3, 3–6, 6–10, 10–24
    expect(segsIn(s, PARTS[0]).map((x) => x.i)).toEqual([0, 1]); // Ночь 00–04 задевает 0–3 и 3–6
  });

  it('rateAt берёт скорость на начало интервала, а конец исключён', () => {
    const s = toSegs(неровный);
    expect(rateAt(s, 3)).toBe(0.55);
    expect(rateAt(s, 2.99)).toBe(0.6);
  });

  it('время печатается получасами', () => {
    expect(fmtH(0)).toBe('00:00');
    expect(fmtH(9.5)).toBe('09:30');
  });
});

describe('часовой пояс профиля', () => {
  it('смещение считается с учётом перехода на летнее время', () => {
    // Европа/Москва зимой и летом одинаково UTC+3, а Берлин переходит
    expect(tzOffsetMinutes('Europe/Moscow', new Date('2026-01-15T12:00:00Z'))).toBe(180);
    expect(tzOffsetMinutes('Europe/Moscow', new Date('2026-07-15T12:00:00Z'))).toBe(180);
    expect(tzOffsetMinutes('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(120);
  });

  it('полночь не ломает расчёт: Intl отдаёт «24» вместо «00»', () => {
    // момент, когда в Екатеринбурге ровно полночь
    expect(tzOffsetMinutes('Asia/Yekaterinburg', new Date('2026-07-14T19:00:00Z'))).toBe(300);
  });

  it('незнакомый пояс не даёт выдуманной разницы', () => {
    expect(tzOffsetMinutes('Не/Пояс')).toBeNull();
    expect(tzShiftMinutes('Не/Пояс')).toBe(0);
  });

  it('без пояса в профиле разницы нет', () => {
    expect(tzShiftMinutes(undefined)).toBe(0);
  });

  it('подпись читается по-человечески', () => {
    expect(tzShiftText(120)).toBe('на 2 ч вперёд');
    expect(tzShiftText(-90)).toBe('на 1 ч 30 мин назад');
    expect(tzShiftText(-30)).toBe('на 30 мин назад');
  });
});
