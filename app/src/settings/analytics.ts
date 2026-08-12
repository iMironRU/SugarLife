import { useSyncExternalStore } from 'react';
import { прочитать, записать } from './storage';

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
  return прочитать(KEY) !== '0';
}

export function analyticsOn(): boolean { return state; }

export function setAnalyticsOn(v: boolean): void {
  state = v;
  записать(KEY, v ? '1' : '0');
  subs.forEach((f) => f());
}

export function useAnalyticsOn(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    analyticsOn, analyticsOn,
  );
}
