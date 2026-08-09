/* Сворачивание панели перетаскиванием.

   Почему pointer-события, а не touch: touch-слушатели на дальних предках ненадёжны —
   в вебвью браузера жест мог не доходить, и на телефоне панель не тянулась ни на iOS,
   ни на Android, хотя синтетические touch-события в отладке проходили. Pointer-события
   покрывают палец, мышь и стилус одинаково.

   Кто владеет жестом:
   • начали ТЯНУТЬ ЗА ПАНЕЛЬ — всегда она (панель = ручка, однозначно и предсказуемо);
   • начали в контенте — только если прокручивать по сути нечего (запас меньше 40px),
     иначе это обычная прокрутка и мешать ей нельзя. */
import { setPanelLevel, type PanelLevel } from './panel';

const MAX = 160;
const STEP_1 = 40;
const STEP_2 = 110;
const SCROLL_SLACK = 40; // запас, ниже которого прокрутка бессмысленна

let offset = 0;

const levelOf = (o: number): PanelLevel => (o > STEP_2 ? 2 : o > STEP_1 ? 1 : 0);
const offsetOf = (l: PanelLevel): number => (l === 2 ? STEP_2 + 1 : l === 1 ? STEP_1 + 1 : 0);
const clamp = (v: number) => Math.max(0, Math.min(MAX, v));

// Активный скроллер карусели живёт в теневом DOM ion-content.
function scrollRoom(): number {
  const c = document.querySelector('.pager-pane.is-active ion-content');
  const s = c?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | undefined;
  return s ? s.scrollHeight - s.clientHeight : 0;
}

function apply(next: number) {
  offset = clamp(next);
  setPanelLevel(levelOf(offset));
}

export function resetPanelGesture(): void { offset = 0; }

export function attachPanelGesture(el: HTMLElement): () => void {
  let startY = 0;
  let base = 0;
  let active = false;
  let id: number | null = null;

  const onDown = (e: PointerEvent) => {
    const onPanel = !!(e.target as Element | null)?.closest?.('.hero-panel');
    active = onPanel || scrollRoom() < SCROLL_SLACK;
    if (!active) return;
    id = e.pointerId;
    startY = e.clientY;
    base = offset;
  };

  const onMove = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    apply(base - (e.clientY - startY)); // палец вверх → dy<0 → сворачиваем
  };

  const onUp = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    active = false; id = null;
    apply(offsetOf(levelOf(offset))); // доводим до ближайшей ступени
  };

  el.addEventListener('pointerdown', onDown, { passive: true });
  el.addEventListener('pointermove', onMove, { passive: true });
  el.addEventListener('pointerup', onUp, { passive: true });
  el.addEventListener('pointercancel', onUp, { passive: true });

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}
