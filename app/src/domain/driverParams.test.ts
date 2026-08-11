import { describe, it, expect } from 'vitest';
import { pumpSpec, missingParams } from './driverParams';
import { pumpById, PUMPS } from './catalog';
import type { SettingsSpec } from '@/sources/bridge';

const paradigm = PUMPS.find((p) => /Paradigm 522/.test(p.model)) ?? null;
const modern = PUMPS.find((p) => /780G/.test(p.model)) ?? null;

describe('спека параметров помпы', () => {
  it('у радио-Medtronic спрашиваем серийник и частоту', () => {
    const spec = pumpSpec(paradigm);
    expect(spec?.parameters.map((p) => p.key)).toEqual(['serial', 'region']);
    const region = spec!.parameters.find((p) => p.key === 'region')!;
    expect(region.options).toEqual(['868', '916']);
    expect(region.default).toBe('868');
  });

  it('у современной помпы настраивать нечего — и это не ошибка', () => {
    expect(pumpSpec(modern)).toBeNull();
    expect(pumpSpec(null)).toBeNull();
  });

  it('спека привязана к семейству, а не к одной модели', () => {
    // моделей радио-Medtronic в справочнике десяток — спека должна быть у всех
    const рф = PUMPS.filter((p) => /Paradigm|MiniMed 50[678]/.test(p.model));
    expect(рф.length).toBeGreaterThan(3);
    expect(рф.every((p) => pumpSpec(p) != null)).toBe(true);
  });

  it('id из каталога резолвится (ключ не разъехался с pumps.json)', () => {
    expect(pumpById(paradigm!.id)).not.toBeNull();
  });
});

describe('чего не хватает в форме', () => {
  const spec = pumpSpec(paradigm)!;

  it('пустая форма — не хватает обязательного серийника (у частоты есть умолчание)', () => {
    expect(missingParams(spec, {}).map((p) => p.key)).toEqual(['serial']);
  });

  it('заполнили серийник — спека закрыта', () => {
    expect(missingParams(spec, { serial: '123456' })).toEqual([]);
  });

  it('пустая строка не считается заполнением', () => {
    expect(missingParams(spec, { serial: '' }).map((p) => p.key)).toEqual(['serial']);
  });

  it('необязательные не требуем, а Bool закрыт всегда — у него нет «пусто»', () => {
    const s: SettingsSpec = { parameters: [
      { key: 'note', title: 'Заметка', type: 'Text', required: false, default: null, options: [] },
      { key: 'auto', title: 'Авто', type: 'Bool', required: true, default: null, options: [] },
    ] };
    expect(missingParams(s, {})).toEqual([]);
  });

  it('пустой спеки достаточно, чтобы ничего не требовать', () => {
    expect(missingParams(null, {})).toEqual([]);
    expect(missingParams({ parameters: [] }, {})).toEqual([]);
  });
});
