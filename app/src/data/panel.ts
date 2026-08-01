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

// Обработчик onIonScroll для экранов. ВАЖНО: вкладки остаются смонтированными,
// и уходящая (скрытая) вкладка может прислать событие скролла со своим старым
// scrollTop — оно бы залипило панель в «строке». Поэтому реагируем только на
// событие от ВИДИМОГО ion-content (у скрытого display:none → offsetParent === null).
export function reportContentScroll(e: { target: EventTarget | null; detail: { scrollTop: number } }): void {
  const el = e.target as HTMLElement | null;
  if (!el || el.offsetParent === null) return;
  setPanelScrolled(e.detail.scrollTop > 10);
}
