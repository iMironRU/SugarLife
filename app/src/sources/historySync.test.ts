import { describe, it, expect } from 'vitest';
import { toEntries, окноЗапроса } from './historySync';
import type { GlucosePoint } from './bridge';

const т = (atMs: number, mmol: number | null, trend?: string | null): GlucosePoint =>
  ({ atMs, mmol, source: 'sensor', trend });

describe('окно запроса истории', () => {
  const сейчас = Date.UTC(2026, 7, 11, 12, 0, 0);

  it('от последнего, что уже лежит, с хвостом назад', () => {
    const новейшее = сейчас - 3 * 3600e3;
    const о = окноЗапроса(новейшее, сейчас);
    expect(о.toMs).toBe(сейчас);
    // хвост нужен: последняя точка могла прийти неполной и перезаписаться правильной
    expect(о.fromMs).toBeLessThan(новейшее);
    expect(новейшее - о.fromMs).toBe(10 * 60e3);
  });

  it('база пуста — берём сутки, а не всю историю', () => {
    const о = окноЗапроса(null, сейчас);
    expect(сейчас - о.fromMs).toBe(24 * 3600e3);
  });

  it('база свежая — окно почти нулевое, лишнего не тянем', () => {
    const о = окноЗапроса(сейчас - 60e3, сейчас);
    expect(сейчас - о.fromMs).toBeLessThan(12 * 60e3);
  });
});

describe('перевод точек контракта в измерения', () => {
  it('считает мг/дл из ммоль — в базе живут обе величины', () => {
    const [e] = toEntries([т(1000, 5.5, 'Flat')]);
    expect(e.t).toBe(1000);
    expect(e.mmol).toBe(5.5);
    expect(e.mgdl).toBe(99); // 5.5 × 18.0182 = 99.1
    expect(e.dir).toBe('Flat');
  });

  it('точки без значения выбрасываем, а не превращаем в ноль', () => {
    expect(toEntries([т(1, null), т(2, 5), т(3, NaN)])).toHaveLength(1);
  });

  it('тренда нет — пустая строка, а не выдуманное направление', () => {
    expect(toEntries([т(1, 5)])[0].dir).toBe('');
    expect(toEntries([т(1, 5, null)])[0].dir).toBe('');
  });

  it('битое время не пролезает: ключ хранилища — время', () => {
    expect(toEntries([т(NaN, 5)])).toHaveLength(0);
  });
});
