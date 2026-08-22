import { describe, it, expect } from 'vitest';
import { догадкаМодели } from './догадкаМодели';
import type { UiSnapshot } from '@/sources/bridge';

/* Движок уже понял, что за железка (#485). Проверяем не «красиво ли угадали», а то, из-за чего
   догадка может навредить: подсказать не ту модель (у неё другой резервуар — соврём в прогнозе) или
   промолчать там, где ответ был. */

const снимок = (kind: 'pump' | 'sensor', driverId: string | null, model: string | null): UiSnapshot => ({
  bridgeRevision: '1.30',
  devices: [{ id: 'd1', kind, driverId, model } as unknown as UiSnapshot['devices'][number]],
  roles: [{ role: kind === 'pump' ? 'insulin' : 'cgm', activeSourceId: 'd1' }],
} as unknown as UiSnapshot);

describe('догадка о модели по опознанному прибору', () => {
  /* Главный случай: семейство medtronic, пять моделей, и решает число из имени. */
  it('«Medtronic 722» → Paradigm 522/722, а не соседняя модель', () => {
    const [д] = догадкаМодели('pump', снимок('pump', 'medtronic', 'Medtronic 722'), null);
    expect(д.имя).toBe('Paradigm 522/722');
    expect(д.какНазвался).toBe('Medtronic 722');
    expect(д.точно).toBe(true);
  });

  /* 523/723 и 522/722 отличаются только числом. Перепутать их значит взять чужой резервуар. */
  it('число решает: 723 — это Revel, а не 722', () => {
    const [д] = догадкаМодели('pump', снимок('pump', 'medtronic', 'Medtronic 723'), null);
    expect(д.имя).toContain('Revel');
  });

  /* Единственная модель семейства — это уже ответ, а не догадка. */
  it('семейство из одной модели предлагается точно', () => {
    const [д] = догадкаМодели('sensor', снимок('sensor', 'sibionics', 'GS1-2E4F'), null);
    expect(д.имя).toBe('Sibionics GS1');
    expect(д.точно).toBe(true);
  });

  /* Модель уже выбрана — подсказывать нечего, и лезть с ней поверх выбора человека нельзя. */
  it('модель уже выбрана — молчим', () => {
    expect(догадкаМодели('pump', снимок('pump', 'medtronic', 'Medtronic 722'), 'что-то')).toEqual([]);
  });

  /* Незнакомый драйвер: справочник про него ничего не знает, и выдуманная догадка была бы хуже
     пустоты — по ней человек записал бы не тот прибор. */
  it('незнакомое семейство — пусто, а не наугад', () => {
    expect(догадкаМодели('pump', снимок('pump', 'неведомый-драйвер', 'Что-то'), null)).toEqual([]);
  });

  it('движок молчит — предлагать нечего', () => {
    expect(догадкаМодели('pump', снимок('pump', null, null), null)).toEqual([]);
    expect(догадкаМодели('pump', null, null)).toEqual([]);
  });

  /* Подсказок не больше двух: список длиннее — это второй справочник поверх первого. */
  it('подсказок не больше двух', () => {
    const д = догадкаМодели('pump', снимок('pump', 'medtronic', 'Medtronic'), null);
    expect(д.length).toBeLessThanOrEqual(2);
  });
});

/* Слот помпы часто наполняет облако: активный источник роли — служба «Nightscout», у неё нет ни
   драйвера, ни модели. Первая версия брала её за прибор и предлагала помпу, похожую по буквам на
   слово Nightscout. Ошибка тихая: человек тапнул бы «это она» и получил чужой резервуар. */
describe('облако в слоте — не прибор', () => {
  const сОблаком = (сПомпой: boolean): UiSnapshot => ({
    bridgeRevision: '1.30',
    devices: [
      { id: 'ns', kind: 'service', driverId: null, name: 'Nightscout' },
      ...(сПомпой ? [{ id: 'p', kind: 'pump', driverId: 'medtronic', model: 'Medtronic 722' }] : []),
    ],
    roles: [{ role: 'insulin', activeSourceId: 'ns' }],
  } as unknown as UiSnapshot);

  it('роль наполняет облако, помпы нет — молчим', () => {
    expect(догадкаМодели('pump', сОблаком(false), null)).toEqual([]);
  });

  it('роль наполняет облако, но железо в снимке есть — гадаем по железу', () => {
    const [д] = догадкаМодели('pump', сОблаком(true), null);
    expect(д.имя).toBe('Paradigm 522/722');
  });
});
