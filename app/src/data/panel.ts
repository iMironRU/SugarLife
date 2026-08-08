/* Общий сигнал прокрутки активного экрана для верхней панели.
   Панель сворачивается ступенями по мере прокрутки — на любом экране, включая «Сегодня».
   Каждый экран сообщает свой scrollTop сюда; панель подписана. */
import { useSyncExternalStore } from 'react';

/* Ступень сворачивания: 0 — развёрнуто, 1 — сжато, 2 — строка.
   Как ступень превращается в вид, решает сама панель: на «Сегодня» отсчёт идёт от
   большого состояния (full → compact → line), на прочих экранах — от сжатого
   (compact → line), потому что там панель и так не разворачивается на весь рост. */
export type PanelLevel = 0 | 1 | 2;

const STEP_1 = 12;   // ушли от самого верха
const STEP_2 = 120;  // прокрутили заметно — сворачиваем до строки

let level: PanelLevel = 0;
const subs = new Set<() => void>();

export function setPanelLevel(v: PanelLevel): void {
  if (v !== level) {
    level = v;
    subs.forEach((f) => f());
  }
}

export function usePanelLevel(): PanelLevel {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => level,
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
  const y = e.detail.scrollTop;
  setPanelLevel(y > STEP_2 ? 2 : y > STEP_1 ? 1 : 0);
}
