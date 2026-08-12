import { прочитать, записать, убрать } from './storage';
/* Пройден ли онбординг (docs/CONNECT-UX.md §7, путь 1).
   Онбординг — главный путь, но НЕ стена: человек может выйти и пользоваться приложением
   с прочерками. Флаг нужен именно для этого — чтобы «настрою потом» не превращалось
   в повторный показ мастера при каждом запуске. */
import { useSyncExternalStore } from 'react';

const KEY = 'sl.onboarded.v1';

let state = read();
const subs = new Set<() => void>();

function read(): boolean {
  return прочитать(KEY) === '1';
}

export function isOnboarded(): boolean { return state; }

export function setOnboarded(v: boolean): void {
  state = v;
  if (v) записать(KEY, '1'); else убрать(KEY);
  subs.forEach((f) => f());
}

export function useOnboarded(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    isOnboarded, isOnboarded,
  );
}
