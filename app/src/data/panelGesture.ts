/* Сворачивание панели жестом — для экранов, где контент помещается целиком.
   Зачем: панель лежит НАД областью прокрутки, поэтому «свернуть прокруткой» там, где
   прокручивать нечего, можно было бы только выдумав искусственный запас — а он уводит
   контент вверх, под панель. Вместо этого панель забирает жест себе: контент стоит на
   месте, двигается только панель. Где контент реально длинный — жест не трогаем,
   ступени считает reportContentScroll по scrollTop. */
import { setPanelLevel, type PanelLevel } from './panel';

// «виртуальная прокрутка» панели: сколько пикселей жеста уже съедено
const MAX = 160;
const STEP_1 = 40;
const STEP_2 = 110;

let offset = 0;

const levelOf = (o: number): PanelLevel => (o > STEP_2 ? 2 : o > STEP_1 ? 1 : 0);
const offsetOf = (l: PanelLevel): number => (l === 2 ? STEP_2 + 1 : l === 1 ? STEP_1 + 1 : 0);
const clamp = (v: number) => Math.max(0, Math.min(MAX, v));

// Активный скроллер карусели. У ion-content он в теневом DOM, поэтому достаём оттуда:
// нужен синхронный ответ «есть ли что прокручивать», getScrollElement() асинхронный.
function activeScroller(): HTMLElement | null {
  const content = document.querySelector('.pager-pane.is-active ion-content');
  return (content?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement) ?? null;
}

// Жест наш, только если прокручивать нечего — иначе управляет обычный скролл.
function gestureOwnsPanel(): boolean {
  const s = activeScroller();
  if (!s) return false;
  return s.scrollHeight <= s.clientHeight + 2;
}

function apply(next: number) {
  offset = clamp(next);
  setPanelLevel(levelOf(offset));
}

// Сбросить «виртуальную прокрутку» — при смене вкладки панель разворачивается заново.
export function resetPanelGesture(): void { offset = 0; }

export function attachPanelGesture(el: HTMLElement): () => void {
  let startY = 0;
  let base = 0;
  let active = false;

  const onTouchStart = (e: TouchEvent) => {
    active = gestureOwnsPanel();
    if (!active) return;
    startY = e.touches[0].clientY;
    base = offset;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!active) return;
    // палец вверх → dy отрицательный → панель сворачивается
    const dy = e.touches[0].clientY - startY;
    apply(base - dy);
  };

  const onTouchEnd = () => {
    if (!active) return;
    active = false;
    // фиксируем ступень целиком, чтобы панель не зависала в промежуточном положении
    apply(offsetOf(levelOf(offset)));
  };

  const onWheel = (e: WheelEvent) => {
    if (!gestureOwnsPanel()) return;
    apply(offset + e.deltaY);
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });
  el.addEventListener('wheel', onWheel, { passive: true });

  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    el.removeEventListener('wheel', onWheel);
  };
}
