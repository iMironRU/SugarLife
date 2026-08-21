import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Имя издания расходится ВЕЗДЕ, где человек его видит (#392).

   На телефоне владельца стоят оба приложения. Разошлись мы аккуратно всюду —
   идентификатор, иконка, схема ссылки, — а имя забыли, и оба значка оказались подписаны
   «SugarLife.Lite». Эти два издания по-разному относятся к подаче инсулина: открыть не то
   — не косметическая ошибка.

   Первая правка заменила `app_name` и выглядела законченной. Но лаунчер показывает метку
   АКТИВНОСТИ, когда она задана, а она задана — `title_activity_main`. Подпись под значком
   осталась прежней, и жалоба осталась в силе.

   Отсюда правило, которое стережёт машина: ЛЮБАЯ строка в main, где написано «Lite», обязана
   быть переопределена в pro. Не перечисление известных имён — их список и подвёл в прошлый
   раз, — а сам признак: увидел «Lite» в общем месте, изволь ответить, чем это будет в Pro. */

const КОРЕНЬ = join(process.cwd(), '..');
const MAIN = 'app/android/app/src/main/res/values/strings.xml';
const PRO = 'app/android/app/src/pro/res/values/strings.xml';

function строки(путь: string): Record<string, string> {
  const текст = readFileSync(join(КОРЕНЬ, путь), 'utf8');
  const итог: Record<string, string> = {};
  for (const м of текст.matchAll(/<string name="([^"]+)"\s*>([^<]*)<\/string>/g)) итог[м[1]] = м[2];
  return итог;
}

describe('издания подписаны по-разному', () => {
  it('всё, где в main написано Lite, переопределено в pro', () => {
    const main = строки(MAIN);
    const pro = строки(PRO);
    const забыли = Object.entries(main)
      .filter(([, v]) => v.includes('Lite'))
      .map(([k]) => k)
      .filter((k) => !(k in pro));
    expect(забыли).toEqual([]);
  });

  it('в pro не осталось слова Lite', () => {
    const остатки = Object.entries(строки(PRO)).filter(([, v]) => v.includes('Lite'));
    expect(остатки).toEqual([]);
  });

  /* iOS: имя живёт в проекте и одинаково в обеих конфигурациях, поэтому его передают сборке
     вместе с bundle id. Без этой строки Pro приезжает на телефон под чужим именем — тот же
     баг, только другим путём. */
  it('сборка iOS передаёт имя издания вместе с идентификатором', () => {
    const скрипт = readFileSync(join(КОРЕНЬ, 'app/build-all.sh'), 'utf8');
    expect(скрипт).toMatch(/APP_DISPLAY_NAME="\$DNAME"/);
    expect(скрипт).toMatch(/DNAME="SugarLife\.Pro"/);
  });
});
