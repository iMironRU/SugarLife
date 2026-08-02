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

// Обработчик onIonScroll для экранов. В карусели все вкладки смонтированы (просто
// сдвинуты), поэтому реагируем ТОЛЬКО на скролл АКТИВНОЙ панели карусели
// (.pager-pane.is-active) — иначе прокрутка соседней вкладки залипила бы «строку».
export function reportContentScroll(e: { target: EventTarget | null; detail: { scrollTop: number } }): void {
  const el = e.target as HTMLElement | null;
  if (!el) return;
  const pane = el.closest?.('.pager-pane');
  if (pane && !pane.classList.contains('is-active')) return;
  setPanelScrolled(e.detail.scrollTop > 10);
}
