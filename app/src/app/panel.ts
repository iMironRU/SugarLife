/* Общий сигнал прокрутки активного экрана для верхней панели.
   Панель сворачивается ступенями по мере прокрутки — на любом экране, включая «Сегодня».
   Каждый экран сообщает свой scrollTop сюда; панель подписана. */
import { useSyncExternalStore } from 'react';

/* Ступень сворачивания: 0 — развёрнуто, 1 — сжато, 2 — строка.
   Как ступень превращается в вид, решает сама панель: на «Сегодня» отсчёт идёт от
   большого состояния (full → compact → line), на прочих экранах — от сжатого
   (compact → line), потому что там панель и так не разворачивается на весь рост. */
export type PanelLevel = 0 | 1 | 2;

/* Пороги ступеней. Их ДВА комплекта — на сворачивание и на разворачивание, и это
   не избыточность: с одним порогом панель мигает, когда палец стоит ровно на
   границе (дрожание в пару пикселей перебрасывает состояние туда-сюда, а каждый
   переброс — это анимация на 0.28 с). Разведённые пороги дают залипание. */
const DOWN_1 = 12,  UP_1 = 6;    // развёрнуто ↔ сжато
const DOWN_2 = 120, UP_2 = 96;   // сжато ↔ строка

let level: PanelLevel = 0;
const subs = new Set<() => void>();

export function setPanelLevel(v: PanelLevel): void {
  if (v !== level) {
    level = v;
    subs.forEach((f) => f());
  }
}

/* ЕДИНСТВЕННЫЙ вход для ступени панели.

   Раньше их было два: прокрутка писала уровень по своим порогам (12/120), а жест
   перетаскивания — по своим (40/110). Два разных перевода одного и того же движения
   в одно и то же состояние; кто последний написал, тот и прав. Отсюда и дёрганье:
   на длинном экране жест то забирал владение, то нет, и панель трактовала одно
   движение двумя способами.

   Теперь и прокрутка, и перетаскивание приводятся к одной величине в пикселях —
   «насколько ушли от верха» — и попадают сюда. */
export function setCollapse(px: number): void {
  const c = Math.max(0, px);
  const next: PanelLevel =
    level === 0 ? (c > DOWN_2 ? 2 : c > DOWN_1 ? 1 : 0)
    : level === 1 ? (c > DOWN_2 ? 2 : c < UP_1 ? 0 : 1)
    : (c < UP_1 ? 0 : c < UP_2 ? 1 : 2);
  setPanelLevel(next);
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
  setCollapse(e.detail.scrollTop);
}


/* Открыта ли страница поверх вкладки.

   Нужно панели: в большом виде круг выступает ниже её рамки и накрывает верх
   содержимого. На «Сегодня» под ним пусто и это незаметно, а страница раздела
   начинается сразу под панелью — и первая карточка уезжала под круг. Да и по
   смыслу: в разделе крупный круг не нужен, там смотрят не на сахар. */
let overlay = false;
const oSubs = new Set<() => void>();
export function setOverlayOpen(v: boolean): void {
  if (v === overlay) return;
  overlay = v;
  oSubs.forEach((f) => f());
}
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    (cb) => { oSubs.add(cb); return () => { oSubs.delete(cb); }; },
    () => overlay, () => overlay,
  );
}
