import { describe, it, expect } from 'vitest';
import { переход, фразаСобытия } from './bleActivity';

/* Проверяем ПРАВИЛО, а не механику. Сам дифф держит состояние между снимками и дёргает
   вибро — его без устройства не подержать. А в правиле живут обе ошибки, которые здесь
   возможны: «дёргает на каждый чих» и «молчит, когда связь потеряна». */

describe('что считать событием подключения', () => {
  it('пошло подключение — лёгкий отклик', () => {
    expect(переход('off', 'connecting')).toBe('capturing');
  });

  it('данные пошли — успех, с любой промежуточной фазы', () => {
    expect(переход('connecting', 'live')).toBe('captured');
    expect(переход('acquiring', 'live')).toBe('captured');
    expect(переход('off', 'live')).toBe('captured');
  });

  it('связь потеряна — событие с любой фазы, это нельзя пропустить', () => {
    expect(переход('live', 'off')).toBe('released');
    expect(переход('acquiring', 'off')).toBe('released');
    expect(переход('connecting', 'off')).toBe('released');
  });

  it('ничего не изменилось — молчим', () => {
    for (const ф of ['off', 'connecting', 'acquiring', 'live'] as const) {
      expect(переход(ф, ф)).toBeNull();
    }
  });

  it('подключается → прогревается: для человека это одно «идёт», второго тычка не даём', () => {
    expect(переход('connecting', 'acquiring')).toBeNull();
    expect(переход('acquiring', 'connecting')).toBeNull();
  });

  it('уход из live в прогрев событием не считаем: связь есть, паниковать не о чем', () => {
    expect(переход('live', 'acquiring')).toBeNull();
  });
});

describe('фразы событий', () => {
  it('читаются человеком и называют устройство', () => {
    expect(фразаСобытия({ id: 'x', name: 'Sibionics GS1', phase: 'captured', at: 0 }))
      .toBe('«Sibionics GS1» на связи');
    expect(фразаСобытия({ id: 'x', name: 'OrangeLink', phase: 'released', at: 0 }))
      .toBe('«OrangeLink» отключился');
    expect(фразаСобытия({ id: 'x', name: 'Dexcom', phase: 'capturing', at: 0 }))
      .toBe('Подключаюсь к «Dexcom»…');
  });
});
