/* ГОРИЗОНТАЛЬНЫЙ ЖЕСТ — свой, вместо `createGesture` из Ionic (SugarLife#405).

   Мест всего два: свайп между вкладками и «назад» в стеке страниц. Ради них в первом экране жила вся
   библиотека, а нужен от неё был десяток строк: понять, что палец пошёл вбок, а не вниз, посчитать
   смещение и скорость, отдать их обратно.

   ПОРОГ И НАПРАВЛЕНИЕ РЕШАЮТСЯ ОДИН РАЗ. Пока смещение меньше порога, мы не решили ничего и никому не
   мешаем: страница продолжает прокручиваться. Как только порог пройден — смотрим, чего больше, X или
   Y, и либо забираем жест себе до конца касания, либо не вмешиваемся вовсе. Решать это на каждом
   движении значило бы отдавать и забирать управление посреди пальца — ровно та рваность, которую мы
   вычищали из панели.

   СКОРОСТЬ — ПО ПОСЛЕДНЕМУ ОТРЕЗКУ, А НЕ ПО ВСЕМУ ПУТИ. Человек может тянуть медленно, а в конце
   дёрнуть: по среднему это «медленно», по последнему отрезку — «бросок», и именно так он и ощущается.

   `touch-action` не трогаем: им управляет CSS у самих элементов, и менять его отсюда значило бы
   спорить с разметкой, которая уже работает. */

export interface Движение {
  deltaX: number;
  deltaY: number;
  /** Пиксели в миллисекунду по горизонтали. Знак — направление. */
  velocityX: number;
  startX: number;
  startY: number;
}

export interface Жест {
  enable(): void;
  destroy(): void;
}

export interface НастройкиЖеста {
  el: HTMLElement;
  /** Сколько пикселей терпим, прежде чем решить, наш это жест или прокрутка. */
  threshold?: number;
  canStart?: (д: { startX: number; startY: number }) => boolean;
  onStart?: () => void;
  onMove?: (д: Движение) => void;
  onEnd?: (д: Движение) => void;
}

/** Скорость по последнему отрезку; 0 при нулевом времени — деления на ноль в жесте не бывает. */
export function скорость(dx: number, dtМс: number): number {
  return dtМс > 0 ? dx / dtМс : 0;
}

/** Наш ли это жест: порог пройден И движение горизонтальнее вертикального. */
export function этоНаш(dx: number, dy: number, порог: number): boolean {
  return Math.abs(dx) >= порог && Math.abs(dx) > Math.abs(dy);
}

/** Отказ: порог пройден по вертикали — значит человек листает, и вмешиваться нельзя. */
export function этоПрокрутка(dx: number, dy: number, порог: number): boolean {
  return Math.abs(dy) >= порог && Math.abs(dy) >= Math.abs(dx);
}

export function создатьЖест(н: НастройкиЖеста): Жест {
  const порог = н.threshold ?? 10;
  let включён = false;
  let startX = 0, startY = 0, startT = 0;
  let прошлыйX = 0, прошлоеВремя = 0, скоростьX = 0;
  let решено: 'наш' | 'чужой' | null = null;

  const касание = (e: TouchEvent) => e.touches[0] ?? e.changedTouches[0];

  const начало = (e: TouchEvent) => {
    if (!включён || решено) return;
    const t = касание(e);
    if (!t) return;
    startX = прошлыйX = t.clientX;
    startY = t.clientY;
    startT = прошлоеВремя = e.timeStamp;
    скоростьX = 0;
    решено = null;
    if (н.canStart && !н.canStart({ startX, startY })) решено = 'чужой';
  };

  const движение = (e: TouchEvent) => {
    if (!включён || решено === 'чужой') return;
    const t = касание(e);
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (решено === null) {
      if (этоПрокрутка(dx, dy, порог)) { решено = 'чужой'; return; }
      if (!этоНаш(dx, dy, порог)) return;
      решено = 'наш';
      н.onStart?.();
    }

    скоростьX = скорость(t.clientX - прошлыйX, e.timeStamp - прошлоеВремя);
    прошлыйX = t.clientX;
    прошлоеВремя = e.timeStamp;
    /* Раз жест наш — страница под пальцем не должна ехать заодно. Слушатель неленивый именно ради
       этой строки: у пассивного `preventDefault` не работает вовсе. */
    if (e.cancelable) e.preventDefault();
    н.onMove?.({ deltaX: dx, deltaY: dy, velocityX: скоростьX, startX, startY });
  };

  const конец = (e: TouchEvent) => {
    const было = решено;
    решено = null;
    if (!включён || было !== 'наш') return;
    const t = касание(e);
    const dx = t ? t.clientX - startX : прошлыйX - startX;
    const dy = t ? t.clientY - startY : 0;
    /* Палец остановился и держится — это не бросок. Иначе давняя скорость довела бы страницу до
       конца, хотя человек уже передумал и ждёт. */
    const простой = e.timeStamp - прошлоеВремя;
    const v = простой > 120 ? 0 : скоростьX;
    н.onEnd?.({ deltaX: dx, deltaY: dy, velocityX: v, startX, startY });
    void startT;
  };

  const слушатели: Array<[string, EventListener, AddEventListenerOptions?]> = [
    ['touchstart', начало as EventListener, { passive: true }],
    ['touchmove', движение as EventListener, { passive: false }],
    ['touchend', конец as EventListener, { passive: true }],
    ['touchcancel', конец as EventListener, { passive: true }],
  ];

  return {
    enable() {
      if (включён) return;
      включён = true;
      слушатели.forEach(([имя, ф, о]) => н.el.addEventListener(имя, ф, о));
    },
    destroy() {
      включён = false;
      слушатели.forEach(([имя, ф, о]) => н.el.removeEventListener(имя, ф, о as EventListenerOptions));
    },
  };
}
