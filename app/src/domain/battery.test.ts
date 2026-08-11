import { describe, it, expect } from 'vitest';
import { batteryRuntime } from './battery';
import { compressPlateaus } from './plateau';
import type { DevPoint } from './types';

const ЧАС = 3600e3;
const t0 = Date.UTC(2026, 5, 1, 0, 0, 0);
const p = (ч: number, pumpBattery: number | null): DevPoint =>
  ({ t: t0 + ч * ЧАС, reservoir: null, pumpBattery, uploaderBattery: null });

describe('сколько помпа работает на дне шкалы', () => {
  it('считает от ПЕРВОГО касания дна до замены', () => {
    // 1% с 10-го часа, замена на 20-м → десять часов на дне
    const r = batteryRuntime([p(0, 40), p(5, 20), p(10, 1), p(15, 1), p(20, 1), p(21, 90)]);
    expect(r.floorPct).toBe(1);
    expect(r.cycles).toBe(1);
    expect(r.samples[0]).toBe(10);
  });

  it('медиана, а не среднее: один длинный случай не должен тянуть оценку', () => {
    const цикл = (старт: number, наДне: number) => [
      p(старт, 60), p(старт + 1, 1), p(старт + 1 + наДне, 1), p(старт + 2 + наДне, 80),
    ];
    const r = batteryRuntime([...цикл(0, 5), ...цикл(100, 9), ...цикл(200, 50)]);
    expect(r.cycles).toBe(3);
    expect(r.medianHours).toBe(9);        // медиана
    const среднее = r.samples.reduce((a, b) => a + b, 0) / 3;
    expect(среднее).toBeGreaterThan(20);  // среднее врёт — ради этого и медиана
  });

  it('дно шкалы берётся из данных, а не считается нулём', () => {
    // помпа этого человека ниже 2% не опускается — значит дно у него 2
    const r = batteryRuntime([p(0, 50), p(1, 2), p(6, 2), p(7, 90)]);
    expect(r.floorPct).toBe(2);
    expect(r.samples[0]).toBe(5);
  });

  it('замена — это подъём заряда; плавное падение циклом не считается', () => {
    const r = batteryRuntime([p(0, 75), p(10, 44), p(20, 29), p(30, 22), p(40, 3), p(50, 1)]);
    expect(r.cycles).toBe(0);       // замены не было — считать нечего
    expect(r.medianHours).toBeNull();
  });

  it('пока замены не видели, «дно» не объявляем — это просто текущий заряд', () => {
    // ровно случай коротких данных: три дня, помпа не опускалась ниже 14%
    const r = batteryRuntime([p(0, 30), p(10, 20), p(20, 14)]);
    expect(r.floorPct).toBeNull();
    expect(r.cycles).toBe(0);
  });

  it('мелкий подъём — дрожание шкалы, а не новая батарейка', () => {
    const r = batteryRuntime([p(0, 20), p(1, 1), p(5, 1), p(6, 4), p(10, 1), p(11, 95)]);
    expect(r.cycles).toBe(1);       // одна замена в конце, а не две
  });

  it('без данных не выдумываем', () => {
    expect(batteryRuntime([]).medianHours).toBeNull();
    expect(batteryRuntime([p(0, null)]).floorPct).toBeNull();
    expect(batteryRuntime([p(0, 50)]).cycles).toBe(0);
  });
});

describe('сжатие истории заряда', () => {
  const b = (t: number, v: number) => ({ t, v });

  it('от плато остаются ОБА края — иначе теряется его длина', () => {
    // это и был баг: хранили только вход на плато, и «сколько продержалась» = 0
    const r = compressPlateaus([b(1, 1), b(2, 1), b(3, 1), b(4, 1), b(5, 80)]);
    expect(r.map((x) => x.t)).toEqual([1, 4, 5]);
  });

  it('одиночные значения не теряются', () => {
    expect(compressPlateaus([b(1, 50), b(2, 40), b(3, 30)]).map((x) => x.t)).toEqual([1, 2, 3]);
  });

  it('длина плато сохраняется — на этом держится весь расчёт', () => {
    const хранимое = compressPlateaus([b(0, 60), b(1, 1), b(2, 1), b(3, 1), b(10, 1), b(11, 80)]);
    const r = batteryRuntime(хранимое.map((x) => ({ t: x.t * 3600e3, reservoir: null, pumpBattery: x.v, uploaderBattery: null })));
    expect(r.samples[0]).toBe(9); // с 1-го часа по 10-й
  });

  it('сортирует и чистит мусор', () => {
    const r = compressPlateaus([b(5, 20), b(1, 50), b(NaN, 3), b(3, 20)]);
    expect(r.map((x) => x.v)).toEqual([50, 20, 20]);
  });

  it('повторное сжатие ничего не меняет — данные копятся дозагрузками', () => {
    const один = compressPlateaus([b(1, 1), b(2, 1), b(3, 1), b(4, 80)]);
    expect(compressPlateaus(один)).toEqual(один);
  });
});
