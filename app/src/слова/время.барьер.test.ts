import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Дата собирается в одном месте (#408).

   Двенадцать мест форматировали её руками, каждое по-своему, и разошлись именно так, как
   расходятся два списка одного и того же: «сегодня» и «Сегодня», «19 авг» и «19 августа»,
   «9:05» и «09:05». Ни одно расхождение не падало — их просто видел человек на соседних
   экранах и делал вывод, что приложение сшито из кусков.

   Сторож нужен потому, что соблазн велик: `toLocaleTimeString` пишется в одну строку, а
   выучить, что для этого есть слово, можно только один раз. */

function файлы(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? файлы(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const ДОМ = 'слова/время.ts';

describe('формат даты — в одном месте', () => {
  it('toLocale* вне слова/время.ts не встречается', () => {
    const нарушители: string[] = [];
    for (const f of файлы('src')) {
      if (f.endsWith(ДОМ) || f.includes('время.барьер')) continue;
      const текст = readFileSync(f, 'utf8');
      for (const m of текст.matchAll(/\.toLocale\w*\s*\(/g)) нарушители.push(`${f}: ${m[0]}`);
    }
    expect(нарушители).toEqual([]);
  });

  it('дом на месте — иначе сторож охраняет пустоту', () => {
    const дом = readFileSync(join('src', ДОМ), 'utf8');
    /* Без \b: границу слова JS считает по латинице, и `часы\b` не совпадёт никогда —
       после «ы» стоит пробел, но сама «ы» для регулярки не буква. Сторож, который не
       умеет сработать, хуже отсутствующего: он создаёт видимость проверки. */
    for (const имя of ['часы', 'деньМесяц', 'имяДня', 'сколькоНазад']) {
      expect(дом).toMatch(new RegExp(`export (function|const) ${имя}[ (:=]`));
    }
  });
});
