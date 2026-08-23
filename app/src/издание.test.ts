import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* БАРЬЕР ИЗДАНИЙ (SugarLife#296).

   Pro отличается от Lite не набором кнопок, а наличием кода управления подачей. Значит его нельзя
   исключить, если он растёкся вкраплениями по общим экранам: `if (pro) …` внутри карточки прибора
   означает, что код отправки команд лежит в Lite-бандле и просто не вызывается.

   Правило одно: **в `src/pro/` ходят только через `src/издание.ts`.** Тогда исключение издания — это
   одна ветка, а не ревизия каждого компонента.

   Проверяем текстом по исходникам, а не сборкой: сборка ловит то же самое, но на десять минут позже и
   только в CI. */

const КОРЕНЬ = join(process.cwd(), 'src');
const КАЛИТКА = join(КОРЕНЬ, 'издание.ts');

function файлы(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? файлы(p) : [p];
    });
  } catch { return []; }
}

describe('издания разъезжаются сборкой, а не условиями в общих экранах', () => {
  it('в src/pro/ ходят только через калитку', () => {
    const нарушители: string[] = [];
    for (const f of файлы(КОРЕНЬ)) {
      if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
      if (f === КАЛИТКА || f.startsWith(join(КОРЕНЬ, 'pro'))) continue;
      if (f.endsWith('издание.test.ts')) continue;
      const текст = readFileSync(f, 'utf8');
      if (/from '@\/pro\/|from '\.\.?\/pro\//.test(текст)) нарушители.push(f.replace(КОРЕНЬ, ''));
    }
    expect(нарушители).toEqual([]);
  });

  /* Признак издания читается ТОЛЬКО из калитки. Иначе `__ИЗДАНИЕ__` расползётся по экранам, и каждое
     такое место придётся проверять отдельно — а забытое даст в Lite кнопку, за которой ничего нет. */
  it('признак издания читает только калитка', () => {
    const нарушители = файлы(КОРЕНЬ)
      .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== КАЛИТКА)
      .filter((f) => !f.endsWith('издание.test.ts'))
      /* Объявление типа не в счёт: `globals.d.ts` только называет константу, а читает её калитка.
         Тип исчезает при сборке и ветку в Lite не оживляет. */
      .filter((f) => !f.endsWith('globals.d.ts'))
      .filter((f) => /__ИЗДАНИЕ__/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(КОРЕНЬ, ''));
    expect(нарушители).toEqual([]);
  });
});
