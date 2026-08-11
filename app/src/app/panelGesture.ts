/* Подпруживание контента и сворачивание панели — один жест, одна шкала.

   Что было не так. Механизмов было два: прокрутка двигала панель по своим порогам,
   перетаскивание — по своим, и они переписывали одно состояние разными шкалами.
   Плюс на коротких экранах не происходило вообще ничего: прокручивать нечего,
   значит и событий прокрутки нет, а нативная резинка выключена (forceOverscroll={false}).
   Получалось, что «пружинит» только там, где контент не влезает.

   Что теперь. Упругость считаем сами и рисуем сдвигом контента. Одинаково на iOS,
   Android и в вебе — потому что нативную резинку мы глушим совсем
   (overscroll-behavior: none, см. app.css), и она не может ни задвоиться с нашей,
   ни отличаться от телефона к телефону. Ступень панели при этом всегда идёт через
   setCollapse — единственный вход.

   Почему pointer-события, а не touch: touch-слушатели на дальних предках ненадёжны —
   жест мог не доходить до вебвью, и панель не тянулась ни на iOS, ни на Android,
   хотя синтетические события в отладке проходили. Pointer покрывает палец, мышь и
   стилус одинаково. */

const MAX_PULL = 110;     // предел упругого сдвига, дальше палец «упирается»
const SLOP = 4;           // до этого движение ещё не жест, а дрожание пальца
const BACK_MS = 320;      // возврат после отпускания


export function resetPanelGesture(): void { /* состояние сворачивания живёт в panel.ts */ }

const activePane = (): HTMLElement | null => document.querySelector('.pager-pane.is-active');

/* Что сейчас под пальцем — экран вкладки или страница стека поверх него.

   Раньше жест знал только про ion-content вкладки. Открыв «Устройства» или
   «Аналитику», человек тянул страницу стека, а решение «прокручивать нечего»
   принималось по экрану ПОД ней: у того прокрутка своя, и она почти всегда в нуле.
   Отсюда и ощущение, что список не листается, а упирается — жест уходил в
   оттягивание невидимого экрана вместо прокрутки видимого.

   Возвращаем пару: чем прокручивать и что двигать при оттягивании. Верхняя страница
   стека главнее — она и видна. */
interface Цель { scroller: HTMLElement | null; move: HTMLElement | null }

function активнаяЦель(): Цель {
  const pane = activePane();
  if (!pane) return { scroller: null, move: null };

  const страницы = pane.querySelectorAll<HTMLElement>('.stack-page');
  const верх = страницы[страницы.length - 1];
  if (верх) {
    // у страницы стека прокручивается её собственное тело, оно же и сдвигается
    const тело = верх.querySelector<HTMLElement>('.stack-body');
    return { scroller: тело, move: тело };
  }

  const c = pane.querySelector('ion-content');
  return {
    scroller: (c?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null) ?? null,
    move: pane.querySelector<HTMLElement>('.screen'),
  };
}

/* Затухание: первые пиксели идут почти один к одному, дальше всё туже и упирается
   в MAX_PULL. Без него сдвиг был бы линейным — контент уезжал бы за палец без
   ощущения сопротивления, то есть без самого смысла подпруживания. */
const elastic = (dy: number): number => {
  const a = Math.abs(dy);
  return Math.sign(dy) * MAX_PULL * (1 - Math.exp(-a / MAX_PULL));
};

function setPull(screen: HTMLElement | null, px: number, animate: boolean): void {
  if (!screen) return;
  screen.style.transition = animate ? `transform ${BACK_MS}ms cubic-bezier(.2,.8,.2,1)` : '';
  screen.style.transform = px ? `translate3d(0,${px.toFixed(1)}px,0)` : '';
}

export function attachPanelGesture(el: HTMLElement): () => void {
  let startY = 0;
  let startTop = 0;
  let room = 0;
  let onPanel = false;
  let screen: HTMLElement | null = null;
  let mode: null | 'pull' | 'scroll' = null;
  let id: number | null = null;

  const onDown = (e: PointerEvent) => {
    const цель = активнаяЦель();
    const scroller = цель.scroller;
    screen = цель.move;
    id = e.pointerId;
    startY = e.clientY;
    startTop = scroller?.scrollTop ?? 0;
    room = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    onPanel = !!(e.target as Element | null)?.closest?.('.hero-panel');
    mode = null;
    setPull(screen, 0, false); // снять анимацию возврата, если ещё идёт
  };

  const onMove = (e: PointerEvent) => {
    if (id !== e.pointerId) return;
    const dy = e.clientY - startY;

    /* Владение решается на первом заметном движении и больше не меняется — иначе
       жест перескакивал бы между прокруткой и оттягиванием на полпути.
       Прокрутке не мешаем никогда: наше начинается только там, где ей уже некуда
       идти (упёрлись в край) или где её нет вовсе (короткий экран). */
    if (mode === null) {
      if (Math.abs(dy) < SLOP) return;
      const atTop = startTop <= 0;
      const atBottom = startTop >= room - 1;
      mode = onPanel || (dy > 0 ? atTop : atBottom) ? 'pull' : 'scroll';
    }
    if (mode === 'scroll') return;

    setPull(screen, elastic(dy), false);
    /* Сворачивать панель пальцем больше не даём — только настоящей прокруткой.

       Панель теперь висит над содержимым, и отступ у скроллера равен её высоте
       в покое. Когда прокручивать нечего (а на «Сегодня» почти нечего), сворачивание
       по жесту оставляло на месте панели пустую дыру: панель ушла, а содержимое
       осталось стоять. Прокрутка такого не создаёт — там место освобождается ровно
       потому, что содержимое уехало вверх. */
  };

  const onUp = (e: PointerEvent) => {
    if (id !== e.pointerId) return;
    if (mode === 'pull') setPull(screen, 0, true); // контент всегда возвращается на место
    mode = null; id = null; screen = null;
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
