import { describe, it, expect } from 'vitest';
import { тихиеЗаметки } from './тихиеЗаметки';
import type { ActiveAlarmView, UiSnapshot } from '@/sources/bridge';

const т = (o: Partial<ActiveAlarmView> & { id: string }): ActiveAlarmView => ({
  level: 'Заметка', baseLevel: 'Заметка', words: 'падаете 1,3 за 15 мин',
  sinceMs: 1000, needsAck: false, acked: false, improving: false, clearsInMin: 0, ...o,
});
const снимок = (...alarmsNow: ActiveAlarmView[]) => ({ alarmsNow } as unknown as UiSnapshot);

describe('тихие заметки', () => {
  it('берёт заметку — её больше нигде не видно', () => {
    expect(тихиеЗаметки(снимок(т({ id: 'полёт-вниз' }))).map((з) => з.id)).toEqual(['полёт-вниз']);
  });

  it('тревогу не забирает: у неё своя полоса с кнопкой', () => {
    const с = снимок(т({ id: 'гипо', level: 'Разбудить', needsAck: true }));
    expect(тихиеЗаметки(с)).toHaveLength(0);
  });

  it('заметку, ждущую ответа, оставляет полосе тревог: там есть кнопка', () => {
    const с = снимок(т({ id: 'странная', needsAck: true }));
    expect(тихиеЗаметки(с)).toHaveLength(0);
  });

  it('берёт по уровню, а не по имени: новая заметка движка не пропадёт молча', () => {
    const с = снимок(т({ id: 'что-то-новое-от-ядра' }));
    expect(тихиеЗаметки(с).map((з) => з.id)).toEqual(['что-то-новое-от-ядра']);
  });

  it('без слов не показываем: своих не пишем', () => {
    expect(тихиеЗаметки(снимок(т({ id: 'немая', words: '' })))).toHaveLength(0);
  });

  it('свежая выше', () => {
    const с = снимок(т({ id: 'старая', sinceMs: 10 }), т({ id: 'новая', sinceMs: 99 }));
    expect(тихиеЗаметки(с).map((з) => з.id)).toEqual(['новая', 'старая']);
  });

  it('пустой снимок — пустая полоса, а не поломка', () => {
    expect(тихиеЗаметки(null)).toEqual([]);
    expect(тихиеЗаметки({} as UiSnapshot)).toEqual([]);
  });
});
