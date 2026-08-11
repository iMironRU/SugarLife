import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createGesture } from '@ionic/react';
import { StackCtx, type StackApi } from './stackCtx';
import { setCollapse, syncToActiveScreen } from './panel';
import { useGoHome } from './nav';
import { canStartBack, shouldGoBack } from './backGesture';

/* Стек страниц внутри вкладки.

   Почему не модалки. Разделы вроде «Устройства → карточка помпы → базальный профиль» —
   это иерархия: у каждого экрана есть родитель, к которому возвращаются. Модалка
   предназначена для другого — для одноразовой подзадачи, прерывающей поток. Когда
   иерархию изображают модалками, приходится вручную воспроизводить всё, что даёт
   навигация: держать карточку между панелью и таббаром (а значит мерить их высоты в
   JS и ловить отставание), прятать нижний слой, ужимать подложку, гасить события на
   хосте, вести руками список того, что закрыть при смене вкладки.

   Здесь ничего этого нет по построению. Оболочка — HeroPanel → Pager → TabBar, и
   .pager-pane это ровно область между панелью и таббаром. Страница внутри панели
   получает нужные границы сама, через inset: 0. Мерить нечего, отставать нечему.

   Стек свой у каждой вкладки: уходя на другую и возвращаясь, человек ожидает застать
   то же место, где был. */

export function StackHost({ tab, children }: { tab: number; children: ReactNode }) {
  const [pages, setPages] = useState<{ key: number; node: ReactNode }[]>([]);

  const push = useCallback((node: ReactNode) => {
    setPages((p) => [...p, { key: (p[p.length - 1]?.key ?? 0) + 1, node }]);
  }, []);
  const pop = useCallback(() => setPages((p) => p.slice(0, -1)), []);

  const api = useMemo<StackApi>(() => ({ push, pop, depth: pages.length }), [push, pop, pages.length]);

  /* Панель должна знать про открытую страницу и слышать её прокрутку.

     Сигнал сворачивания шёл только от ion-content вкладок, а у страницы стека
     скроллер свой — панель о нём не знала и не сворачивалась. Иногда всё же
     сворачивалась: когда жест перехватывал управление. Отсюда и «ведёт себя
     странно» — срабатывало через раз.

     События scroll не всплывают, поэтому ловим их на перехвате. */
  useEffect(() => {
    // открылась/закрылась страница — панель встаёт по прокрутке того, что теперь видно
    syncToActiveScreen();
  }, [pages.length]);

  // нажали свою вкладку в таб-баре — выходим в корень раздела (см. nav.pressTab)
  const домой = useGoHome(tab);
  useEffect(() => {
    if (домой) setPages((p) => (p.length ? [] : p));
  }, [домой]);

  /* Свайп «назад». Пороги и правила — в app/backGesture.ts, там же тесты: само
     перетаскивание проверяется только пальцем, а вот арифметика решений оставаться
     непроверенной не должна — в порогах живут «закрылось от случайного касания» и
     «не закрылось, хотя тянул через весь экран».

     Соперник у жеста один — свайп между вкладками; он выключен, пока открыта страница
     (см. canStart в App). Два жеста на одно движение — это та самая рваность, которую
     мы вычищали из панели: побеждает то один, то другой, и поведение «через раз». */
  const верх = useRef<HTMLDivElement>(null);
  const [тянут, setТянут] = useState(false);

  useEffect(() => {
    const el = верх.current;
    if (!el || !pages.length) return;
    let W = 1;
    const жест = createGesture({
      el,
      gestureName: 'stack-back',
      direction: 'x',
      threshold: 10,
      canStart: (d) => canStartBack(d.startX),
      onStart: () => {
        W = el.clientWidth || 1;
        el.style.transition = 'none';
        setТянут(true);
      },
      onMove: (d) => {
        // назад тянем только вперёд: движение влево страницу не «переворачивает»
        el.style.transform = `translate3d(${Math.max(0, d.deltaX)}px,0,0)`;
      },
      onEnd: (d) => {
        const dx = Math.max(0, d.deltaX);
        const закрыть = shouldGoBack(dx, W, d.velocityX);
        el.style.transition = 'transform .22s cubic-bezier(.3,.9,.3,1)';
        el.style.transform = закрыть ? `translate3d(${W}px,0,0)` : '';
        if (закрыть) {
          /* Ждём, пока страница доедет за край, и только потом снимаем её со стека:
             иначе она исчезнет посреди движения, и вместо ухода получится мигание. */
          window.setTimeout(() => { setТянут(false); pop(); }, 200);
        } else {
          window.setTimeout(() => setТянут(false), 220);
        }
      },
    });
    жест.enable();
    return () => жест.destroy();
  }, [pages.length, pop]);

  const наПрокрутку = (e: React.UIEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t?.classList?.contains('stack-body')) setCollapse(t.scrollTop);
  };

  return (
    <StackCtx.Provider value={api}>
      {children}
      {pages.map((p, i) => (
        /* Ниже верхней страницы всё скрыто: рисовать нижние незачем, а вот держать
           их смонтированными нужно — иначе возврат терял бы состояние (набранный
           адрес, раскрытую часть суток, правку профиля). */
        <div key={p.key}
          ref={i === pages.length - 1 ? верх : undefined}
          className={'stack-page'
            + (i === pages.length - 1 ? ' is-top' : '')
            /* Пока тянут, страницу под верхней надо ВИДЕТЬ — иначе из-под уходящей
               покажется пустота вместо того, куда возвращаются. */
            + (тянут && i === pages.length - 2 ? ' is-under' : '')}
          aria-hidden={i !== pages.length - 1} onScrollCapture={наПрокрутку}>
          {p.node}
        </div>
      ))}
    </StackCtx.Provider>
  );
}
