import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Сторож: карта объяснений должна ЧИТАТЬСЯ (SugarLife#740).

   Ядро прислало сводку и назвало это самым дорогим из своего списка: `snapshot.help` —
   двадцать две статьи — не читался у нас ни разу. Статьи написаны, лежат в вики, доезжают
   в каждом снимке и не показываются.

   Ошибка тихая по природе: ничего не падает, ничего не краснеет — просто у человека нет
   входа к объяснению, а правило проекта звучит дословно «нет объяснения — нет настройки».
   Такое ловится только сторожем или чужими глазами; в нашем случае — чужими.

   Проверяем не «сколько ссылок», а «читается ли карта вообще»: число мест будет расти, а
   ноль означает, что мы снова вернулись туда, откуда начали. */

const КОРЕНЬ = new URL('../', import.meta.url).pathname;

function файлы(путь: string): string[] {
  return readdirSync(путь, { withFileTypes: true }).flatMap((e) => {
    const полный = join(путь, e.name);
    if (e.isDirectory()) return файлы(полный);
    return e.name.endsWith('.tsx') || e.name.endsWith('.ts') ? [полный] : [];
  });
}

describe('карта объяснений читается', () => {
  const все = файлы(КОРЕНЬ).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

  it('обход находит исходники', () => {
    expect(все.length).toBeGreaterThan(100);
  });

  it('snapshot.help кто-то читает', () => {
    const читатели = все.filter((f) => /snapshot\?\.help|снимок\?\.help/.test(readFileSync(f, 'utf8')));
    expect(читатели, 'help из снимка не читает никто — статьи снова недоступны человеку').not.toEqual([]);
  });

  it('ссылки по темам расставлены не в одном месте', () => {
    const места = все.filter((f) => /ПодробнееПоТеме\s+тема=/.test(readFileSync(f, 'utf8')));
    expect(места.length, 'темы должны стоять там, где понятие появляется на экране').toBeGreaterThanOrEqual(3);
  });
});
