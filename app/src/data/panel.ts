/* Общий сигнал прокрутки активного экрана для верхней панели.
   Панель сворачивается в «строку» (line), когда контент НЕ на «Сегодня» прокручен.
   Каждый экран сообщает свой scrollTop сюда; панель подписана. */
import { useSyncExternalStore } from 'react';

let scrolled = false;
const subs = new Set<() => void>();

export function setPanelScrolled(v: boolean): void {
  if (v !== scrolled) {
    scrolled = v;
    subs.forEach((f) => f());
  }
}

export function usePanelScrolled(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => scrolled,
  );
}
