import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Сторож размеров текста (#325).

   Размеры переведены в rem, чтобы системная настройка «крупный шрифт» вообще действовала.
   Ошибка тут не падает и не видна на глаз: правило в пикселях просто перестаёт слушаться
   человека, а заметит это только тот, у кого зрение слабое, — то есть тот, кому мы этим
   и занимались.

   Половина в px, половина в rem хуже, чем всё в px: настройка работает через раз, и
   доверять ей нельзя. Поэтому проверяем по исходникам, а не по тому, что успело попасть
   на экран.

   Пиксели внутри min() разрешены намеренно: это потолок роста для КРУПНОГО текста —
   число сахара при системном увеличении вырастало до шестидесяти и не помещалось в круг.
   Смысл настройки — вытянуть мелкое до читаемого, а не раздуть то, что и так видно. */

const корень = new URL('./', import.meta.url).pathname;

function css(путь: string): string[] {
  return readdirSync(путь, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? css(join(путь, e.name)) : e.name.endsWith('.css') ? [join(путь, e.name)] : []);
}

describe('размеры текста слушают систему', () => {
  const файлы = css(корень);

  it('файлы темы вообще найдены — иначе проверка молча проходит на пустом месте', () => {
    expect(файлы.length).toBeGreaterThan(5);
  });

  it('каждое объявление font-size задано в rem', () => {
    const беглецы: string[] = [];
    for (const f of файлы) {
      const текст = readFileSync(f, 'utf8');
      for (const m of текст.matchAll(/font-size:([^;{}]*)/g)) {
        const знач = m[1].trim();
        if (!знач.includes('rem') && !знач.includes('var(') && !знач.includes('inherit')) {
          беглецы.push(`${f.split('/').pop()}: font-size:${знач}`);
        }
      }
    }
    expect(беглецы).toEqual([]);
  });
});
