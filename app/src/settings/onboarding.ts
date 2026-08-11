/* Пройден ли онбординг (docs/CONNECT-UX.md §7, путь 1).
   Онбординг — главный путь, но НЕ стена: человек может выйти и пользоваться приложением
   с прочерками. Флаг нужен именно для этого — чтобы «настрою потом» не превращалось
   в повторный показ мастера при каждом запуске. */
import { useSyncExternalStore } from 'react';

const KEY = 'sl.onboarded.v1';

let state = read();
const subs = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function isOnboarded(): boolean { return state; }

export function setOnboarded(v: boolean): void {
  state = v;
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function useOnboarded(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    isOnboarded, isOnboarded,
  );
}
