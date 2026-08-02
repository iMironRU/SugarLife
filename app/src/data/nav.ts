/* Активная вкладка для карусели (свайп между экранами). Заменяет роутинг табов:
   один индекс 0..4, оба — карусель и панель — читают его. Хэш синхронизируем
   для дип-линков (#/today и т.п.), но без реального роутера. */
import { useSyncExternalStore } from 'react';

export const TAB_PATHS = ['/metrics', '/mon', '/today', '/ins', '/profile'];
const DEFAULT = 2; // «Сегодня»

function fromHash(): number {
  try {
    const i = TAB_PATHS.indexOf(location.hash.replace(/^#/, ''));
    return i >= 0 ? i : DEFAULT;
  } catch { return DEFAULT; }
}

let index = fromHash();
const subs = new Set<() => void>();

export function setTab(i: number): void {
  const n = Math.max(0, Math.min(TAB_PATHS.length - 1, i));
  if (n === index) return;
  index = n;
  try { history.replaceState(null, '', '#' + TAB_PATHS[n]); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function getTab(): number { return index; }

export function useTab(): number {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => index,
  );
}
