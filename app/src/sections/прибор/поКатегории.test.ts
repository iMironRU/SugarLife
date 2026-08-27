import { describe, it, expect } from 'vitest';
import { модельКатегории, своёЖелезо, слотМоста, расходники, лентаОблака, имяВыбораМодели } from './поКатегории';
import type { Age } from '@/domain/treatmentStats';

const возраст = (ч: number): Age => ({ days: Math.floor(ч / 24), hours: ч % 24 } as Age);

/* Эти ветки жили размазанными по экрану устройства, и проверить их можно было только
   глазами на телефоне. Здесь они — обычные функции, и вот что за них теперь ручается машина. */
describe('чем категории отличаются', () => {
  it('модель есть у помпы и сенсора, у глюкометра и петли её нет', () => {
    const м = { pumpId: 'medtronic-722', sensorId: 'sibionics-gs1' };
    expect(модельКатегории('pump', м)).toBe('medtronic-722');
    expect(модельКатегории('sensor', м)).toBe('sibionics-gs1');
    expect(модельКатегории('meter', м)).toBeNull();
    expect(модельКатегории('loop', м)).toBeNull();
  });

  /* Глюкометр вносят руками, петля — чужая программа: искать их в эфире и спрашивать про
     мост бессмысленно, а спрашивали одинаково во всех четырёх местах файла. */
  it('своё железо в эфире — только у помпы и сенсора', () => {
    expect(своёЖелезо('pump')).toBe(true);
    expect(своёЖелезо('sensor')).toBe(true);
    expect(своёЖелезо('meter')).toBe(false);
    expect(своёЖелезо('loop')).toBe(false);
    expect(слотМоста('meter')).toBeNull();
  });

  it('у помпы три расходника, у сенсора один, у прочих ни одного', () => {
    const все = { sensor: возраст(30), site: возраст(50), reservoir: возраст(20), battery: возраст(100) };
    expect(расходники('pump', все).map((x) => x[2])).toEqual(['site', 'reservoir', 'battery']);
    expect(расходники('sensor', все).map((x) => x[2])).toEqual(['sensor']);
    expect(расходники('meter', все)).toEqual([]);
  });

  /* Возраста нет — строки нет. Показать «Резервуар —» значит выдать незнание за поломку. */
  it('расходник без возраста не показываем', () => {
    const пусто = { sensor: null, site: null, reservoir: возраст(20), battery: null };
    expect(расходники('pump', пусто).map((x) => x[0])).toEqual(['Резервуар']);
  });

  it('лента облака называет то, что реально приходит', () => {
    expect(лентаОблака('pump', { reservoir: 262.4, pumpBattery: 70 }, true)).toBe('262 ед · 70%');
    expect(лентаОблака('pump', { reservoir: null, pumpBattery: 70 }, true)).toBe('70%');
    expect(лентаОблака('sensor', null, true)).toBe('сахар и тренд');
  });

  /* Пусто — это ответ «оттуда ничего не приходит», а не отсутствие ответа. */
  it('из облака ничего не идёт — так и говорим', () => {
    expect(лентаОблака('pump', {}, true)).toBeNull();
    expect(лентаОблака('sensor', null, false)).toBeNull();
    expect(лентаОблака('meter', null, true)).toBeNull();
  });

  it('заголовок выбора называет прибор', () => {
    expect(имяВыбораМодели('pump')).toBe('Выбор помпы');
    expect(имяВыбораМодели('sensor')).toBe('Выбор сенсора');
  });
});
