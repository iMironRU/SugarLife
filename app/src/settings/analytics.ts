import { useSyncExternalStore } from 'react';

/* Показывать ли разбор данных.

   По умолчанию ВКЛЮЧЕНО. Разбор говорит вещи, которые полезны сразу и без спроса:
   канюля стоит пятый день, половина показаний CGM не доехала, ночью были гипо.
   Прятать это за выключателем, который надо сперва найти, значит спрятать от того,
   кому оно нужнее всего — от человека, который в приложение только пришёл.

   Выключатель нужен для обратного случая: кого-то постоянные замечания раздражают
   или он и так всё знает. Тогда плитка на «Сегодня» гаснет, но не исчезает — иначе
   выключивший однажды уже не вспомнит, что такая возможность вообще была. */

const KEY = 'sl.analytics.v1';

let state = read();
const subs = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function analyticsOn(): boolean { return state; }

export function setAnalyticsOn(v: boolean): void {
  state = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function useAnalyticsOn(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    analyticsOn, analyticsOn,
  );
}
