import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Одна дверь в хранилище (#409).

   Ключи у нас уже в одном списке, и полноту его стережёт reset.test.ts. А вот ходить в
   localStorage можно было мимо — и ходили в двадцати восьми местах.

   Чем это плохо. Обёртки `прочитать`/`записать`/`убрать` глотают отказ хранилища: в
   приватном режиме Safari `setItem` бросает исключение. При прямом вызове про это надо
   помнить каждый раз — и не помнили: в баннере установки четыре вызова стояли без
   защиты, и один из них жил в обработчике нажатия. Кроме того, поведение (квота,
   миграция ключа, запись в диагностику) добавить некуда: править пришлось бы все места
   разом.

   Проверяем по исходникам, а не по поведению: забытый прямой вызов иначе всплывает
   только у того, кто открыл приложение в приватном режиме, — то есть почти никогда, и
   не у нас.

   Комментарии не в счёт: про localStorage можно и нужно писать словами. Ловим вызов —
   `localStorage.что-то(` или `localStorage[`. */

function файлы(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? файлы(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/* Единственное исключение — сам storage.ts: он и есть дверь.

   public/boot-guard.js сюда не попадает по построению: он живёт ВНЕ бандла, потому что
   бандл — ровно то, что ломается (#131), и импортировать ему нечего. */
const ДВЕРЬ = 'settings/storage.ts';

describe('в хранилище — через одну дверь', () => {
  it('прямых вызовов localStorage вне storage.ts нет', () => {
    const нарушители: string[] = [];
    for (const f of файлы('src')) {
      if (f.endsWith(ДВЕРЬ) || f.endsWith('однаДверь.test.ts')) continue;
      const текст = readFileSync(f, 'utf8');
      for (const m of текст.matchAll(/localStorage\s*(?:\.\s*\w+\s*\(|\[)/g)) {
        нарушители.push(`${f}: ${m[0].replace(/\s+/g, '')}`);
      }
    }
    expect(нарушители).toEqual([]);
  });

  it('сама дверь на месте — иначе проверка сторожит пустоту', () => {
    const дверь = readFileSync(join('src', ДВЕРЬ), 'utf8');
    for (const имя of ['прочитать', 'записать', 'убрать', 'прочитатьJson', 'записатьJson']) {
      expect(дверь).toContain(`export function ${имя}`);
    }
  });
});
