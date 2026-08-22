import { describe, it, expect } from 'vitest';
import { analyze } from '@/domain/analysis';
import { словаНаходки } from './находки';
import type { Entry, Treatment } from '@/domain/types';

/* Слова находок. Проверяем не буквы, а то, без чего карточка бесполезна: что слова есть
   у КАЖДОЙ находки, которую разбор вообще может выдать, и что числа из правила доехали
   до фразы. Формулировки правятся часто, и тест, повторяющий их дословно, ломался бы на
   каждой правке, не поймав ни одной ошибки. */

const сейчас = Date.now(), ч = 3600e3, д = 24 * ч;
const мк = (n: number, знач: (i: number) => number): Entry[] =>
  Array.from({ length: n }, (_, i) => ({
    t: сейчас - (n - i) * 5 * 60_000, mmol: знач(i),
  })) as Entry[];
const событие = (type: string, назад: number): Treatment =>
  ({ t: сейчас - назад, type } as Treatment);

describe('у каждой находки есть слова', () => {
  it('разбор на живых данных — ни одной карточки без заголовка и текста', () => {
    const a = analyze(мк(288 * 14, (i) => (i % 300 === 0 ? 3 : 12)), [событие('Site Change', 5 * д)], 14);
    expect(a.insights.length).toBeGreaterThan(0);
    for (const н of a.insights) {
      const с = словаНаходки(н);
      expect(с.title.trim().length, н.вид).toBeGreaterThan(0);
      expect(с.message.trim().length, н.вид).toBeGreaterThan(0);
    }
  });

  /* Числа правила обязаны доехать до фразы: заголовок «Канюля стоит дн.» без числа
     выглядит поломкой, а находка при этом сработала верно. */
  it('числа из правила попадают в заголовок', () => {
    const с = словаНаходки({ id: 'site', вид: 'канюля-пора', kind: 'device', severity: 'warn', п: { дней: 7 } });
    expect(с.title).toContain('7');
  });

  it('вопрос человеку остаётся там, где он был', () => {
    expect(словаНаходки({ id: 'carbs', вид: 'еда-не-пишется', kind: 'habit', severity: 'warn' }).question)
      .toBeTruthy();
  });
});
