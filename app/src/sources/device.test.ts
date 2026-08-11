import { describe, it, expect } from 'vitest';
import { mergeDevice, normDeviceDocs } from './nightscout';

/* Сборка состояния помпы из нескольких документов devicestatus.

   Проверяем ровно тот случай, из-за которого «инсулин на борту» пропадал с экрана:
   AAPS шлёт короткий документ (только помпа: резервуар, батарея, статус), и в нём
   нет ни IOB, ни базала, ни заряда моста — а он самый свежий. */

const МИН = 60e3;

// Полный документ от цикла
const циклДок = (at: number, iob: number) => ({
  created_at: new Date(at).toISOString(),
  openaps: { iob: { iob }, suggested: { COB: 12 } },
  pump: {
    reservoir: 56, battery: { percent: 75 }, status: { status: 'Замкнутый цикл' },
    extended: { BaseBasalRate: 1.2, OrangeLinkBattery: 80, LastBolusAmount: 3, PumpSuspended: false },
  },
  uploaderBattery: 63,
});

// Короткий документ — только помпа (openaps пустой, extended без показателей цикла)
const помпаДок = (at: number, reservoir: number) => ({
  created_at: new Date(at).toISOString(),
  openaps: {},
  pump: {
    reservoir, battery: { percent: 75 }, status: { status: 'Замкнутый цикл' },
    extended: { Version: '3.2', ActiveProfile: 'D', PumpSuspended: false },
  },
  uploaderBattery: 63,
});

describe('сборка состояния помпы', () => {
  const t = Date.UTC(2026, 7, 11, 7, 0, 0);

  it('короткий документ не стирает то, что посчитал цикл', () => {
    // как отдаёт Nightscout: свежие первыми
    const d = normDeviceDocs([помпаДок(t + 12 * МИН, 75), помпаДок(t + 7 * МИН, 75), циклДок(t, 4.085)]);
    expect(d?.iob).toBe(4.085);        // из документа цикла
    expect(d?.baseBasal).toBe(1.2);
    expect(d?.mountBattery).toBe(80);
    expect(d?.reservoir).toBe(75);      // а резервуар — из самого свежего
    expect(d?.at).toBe(t + 12 * МИН);
  });

  it('устаревший цикл не всплывает: лучше пусто, чем старое как текущее', () => {
    const d = normDeviceDocs([помпаДок(t + 40 * МИН, 75), циклДок(t, 4.085)]);
    expect(d?.iob).toBeNull();
    expect(d?.reservoir).toBe(75);
  });

  it('порядок аргументов ничего не решает', () => {
    const a = mergeDevice(normDeviceDocs([циклДок(t, 2)]), normDeviceDocs([помпаДок(t + 5 * МИН, 75)]));
    const b = mergeDevice(normDeviceDocs([помпаДок(t + 5 * МИН, 75)]), normDeviceDocs([циклДок(t, 2)]));
    expect(a).toEqual(b);
    expect(a?.iob).toBe(2);
  });

  it('свежее значение всегда сильнее прежнего, даже если оба есть', () => {
    const d = normDeviceDocs([циклДок(t + 5 * МИН, 3.5), циклДок(t, 4.085)]);
    expect(d?.iob).toBe(3.5);
  });

  it('признаки потоков складываются, а не подменяются', () => {
    const d = normDeviceDocs([помпаДок(t + 5 * МИН, 75), циклДок(t, 2)]);
    expect(d?.loop).toBe(true); // цикл был, хоть свежий документ и не от него
    expect(d?.pump).toBe(true);
  });

  it('пустого на входе достаточно, чтобы получить пусто', () => {
    expect(normDeviceDocs([])).toBeNull();
    expect(normDeviceDocs(null)).toBeNull();
    expect(mergeDevice(null, null)).toBeNull();
  });
});
