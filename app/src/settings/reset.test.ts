import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE_KEYS, KEPT_KEYS } from './reset';

/* «Сбросить настройки» обязано убирать ВСЁ, что приложение положило в это устройство.
   Список ключей ведётся руками и отставал уже трижды: сперва забыли реестр устройств и
   флаг онбординга, потом профиль петли, потом историю базального профиля.

   Самопроверка в рантайме, которая была раньше, ловит ключ, только если он уже успел
   появиться в localStorage — то есть у того, кто дошёл до соответствующей функции.
   Здесь проверка идёт по исходникам и срабатывает сразу, ещё до запуска. */

function файлы(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? файлы(p) : /\.tsx?$/.test(p) && !/\.test\./.test(p) ? [p] : [];
  });
}

describe('сброс локальных данных', () => {
  it('знает про каждый ключ хранилища, встречающийся в коде', () => {
    const код = файлы('src').map((p) => readFileSync(p, 'utf8')).join('\n');
    /* Ловим и дефисные имена вроде «sl-ns-migrated». Такой ключ однажды приехал со
       стороны — и проскочил мимо проверки, потому что она искала ровно «sl.». Он
       пережил бы сброс данных: человек сбрасывает, заново вводит адрес, а флаг
       говорит «уже сделано». Тест обязан ловить и это. */
    const вКоде = new Set(Array.from(код.matchAll(/['"`](sl[.-][\w.-]+)['"`]/g), (m) => m[1]));
    const учтённые = new Set<string>([...STORAGE_KEYS, ...KEPT_KEYS]);
    const забытые = [...вКоде].filter((k) => !учтённые.has(k)).sort();
    expect(забытые, 'эти ключи не удаляются и не помечены как сохраняемые').toEqual([]);
  });

  it('ключ не может быть одновременно удаляемым и сохраняемым', () => {
    const пересечение = STORAGE_KEYS.filter((k) => (KEPT_KEYS as readonly string[]).includes(k));
    expect(пересечение).toEqual([]);
  });
});
