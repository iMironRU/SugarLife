/* Степень сворачивания верхней панели — одна непрерывная величина 0…1.

   Раньше здесь были три ступени (полная / компактная / строка). Между ступенями
   панель прыгала: часть свойств уже доехала, часть ещё нет, а на месте исчезнувших
   оставалась пустота. Плюс каждая ступень включала переход длиной 0.28 с — своя
   скорость у панели и своя у пальца, и этот рассинхрон читался как рваность.

   Теперь состояний нет вовсе. Есть одна форма, все размеры которой выражены через
   эту величину, и она идёт прямо за прокруткой, без анимации: панель меняется ровно
   за пальцем.

   Величина уходит в CSS-переменную --p, а не в React. Прокрутка сообщает её
   десятки раз в секунду; перерисовывать на каждый кадр компонент со стором,
   мостом и графиком — это те самые пропущенные кадры. Здесь же меняется одно
   число в стиле корневого элемента, дальше всё считает CSS (см. theme/parts/shell.css:
   высота панели, отступ контента и липкая полоса выражены через --p). */

const ДИАПАЗОН = 120; // на скольких пикселях прокрутки панель сворачивается целиком
const ШАГ = 0.004; // мельче — глазу не видно, а запись в стиль не бесплатна

let progress = -1; // -1 = ещё не писали, чтобы первый вызов прошёл всегда

export function setProgress(v: number): void {
  const p = Math.min(1, Math.max(0, v));
  if (Math.abs(p - progress) < ШАГ) return;
  progress = p;
  document.documentElement.style.setProperty('--p', String(Math.round(p * 1000) / 1000));
}

export function getProgress(): number {
  return Math.max(0, progress);
}

/** Прокрутка активного экрана → степень сворачивания. */
export function setCollapse(px: number): void {
  setProgress(Math.max(0, px) / ДИАПАЗОН);
}

/* Обработчик onIonScroll для экранов. В карусели все вкладки смонтированы (просто
   сдвинуты), поэтому реагируем ТОЛЬКО на скролл АКТИВНОЙ панели карусели. */
export function reportContentScroll(e: { target: EventTarget | null; detail: { scrollTop: number } }): void {
  const el = e.target as HTMLElement | null;
  if (!el) return;
  const pane = el.closest?.('.pager-pane');
  if (pane && !pane.classList.contains('is-active')) return;
  setCollapse(e.detail.scrollTop);
}

/* Синхронизация панели с тем экраном, который стал активным.

   Вкладки и страницы стека помнят свою прокрутку. Переключились на вкладку,
   прокрутанную вниз, — панель должна быть свёрнута ровно настолько же, иначе она
   развернётся поверх содержимого, которое стоит на месте. Раньше вместо этого
   панель просто разворачивалась заново — отсюда и скачок при переключении. */
export function syncToActiveScreen(): void {
  const pane = document.querySelector('.pager-pane.is-active');
  if (!pane) { setCollapse(0); return; }
  const stack = pane.querySelector('.stack-page.is-top .stack-body') as HTMLElement | null;
  if (stack) { setCollapse(stack.scrollTop); return; }
  const content = pane.querySelector('ion-content') as (HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }) | null;
  if (content?.getScrollElement) {
    content.getScrollElement().then((el) => setCollapse(el.scrollTop)).catch(() => setCollapse(0));
  } else {
    setCollapse(0);
  }
}
