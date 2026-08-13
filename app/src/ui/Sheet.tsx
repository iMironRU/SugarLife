import { IonModal, IonIcon, createGesture } from '@ionic/react';
import { closeOutline, chevronBack } from 'ionicons/icons';
import { useEffect, useRef, type ReactNode } from 'react';
import { закрыватьЛи, сдвиг, тянемШторку, начинатьЛи } from './sheetGesture';

/* Оболочка шторки — единственное место, где собирается модалка.

   Их было восемь, и ни одна не настроена как соседняя: четыре разные высоты
   открытия (0.75, 0.85, 0.9, авто), три набора классов, два способа закрытия
   (SugarLife#161). Разнобой стоил нам дважды, и оба раза — не красотой.

   ПРОКРУТКА. У шторок с breakpoints вертикальный жест уходит в перетаскивание
   вместо прокрутки: в шторке еды из-за этого нельзя было докрутить до кнопки
   сохранения. Починили в одном файле — в пяти остальных то же поведение осталось,
   просто там пока не заметили. Поэтому breakpoints здесь нет вовсе, и добавлять их
   в отдельной шторке будет нечем: настройка живёт тут.

   БЛОКИРОВКА ЭКРАНА. Правило .sheet-modal { display: flex } перебило .overlay-hidden,
   и закрытая шторка осталась висеть невидимым слоем поверх всего — не нажималось
   ничего. Причина ровно в том, что классов у шторок было несколько и правила писались
   под конкретный. Класс теперь один.

   ПОЧЕМУ ВНУТРИ ОБЫЧНЫЕ DIV, А НЕ IonContent. Высота шторки — по содержимому
   (--height: auto), а auto-высота меряет то, что внутри. IonContent собственной
   высоты не имеет: он растягивается по родителю, и в auto-модалке схлопывается в
   ноль — шторка просто не появляется. Это мы и получили, убрав у шторки еды
   фиксированную высоту: до того ноль прятался за жёстко заданными 88%.

   Поэтому раскладка своя и явная: колонка из шапки, прокручиваемого тела и подвала.
   Шапка и подвал не участвуют в прокрутке по построению — липкость не нужна, а
   крестик и главное действие всегда на месте.

   Чем шторка отличается от раздела — и почему у них разные кнопки. В раздел
   возвращаются: у него есть родитель, стек помнит место, поэтому слева вверху
   стрелка «назад». Шторку закрывают: возвращаться некуда, поэтому справа крестик.
   Одинаковые кнопки на разных по смыслу поверхностях путали бы сильнее, чем разные. */
export default function Sheet({ isOpen, onClose, onBack, title, subtitle, footer, children }: {
  isOpen: boolean;
  onClose: () => void;
  /** Шаг назад ВНУТРИ шторки (каталог: список → карточка). Не выход. */
  onBack?: () => void;
  title: string;
  subtitle?: string;
  /** Закреплённый низ: главное действие, которое не уезжает с прокруткой. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const модалка = useRef<HTMLIonModalElement>(null);
  const оболочка = useRef<HTMLDivElement>(null);
  const тело = useRef<HTMLDivElement>(null);
  const жест = useRef<{ destroy: () => void } | null>(null);

  /* Закрываем ВСЕГДА через саму модалку, а не сменой состояния снаружи.

     Было видно глазами: крестик закрывал мгновенно, а тап по затемнению — с уходом
     вниз. Потому что затемнение идёт штатным путём Ionic (dismiss с анимацией), а
     крестик дёргал состояние родителя, и React снимал шторку без всякого ухода. Одно
     действие, два разных вида — то же, от чего мы избавлялись у страниц разделов.

     Теперь путь один: dismiss() у модалки, а наружу мы сообщаем в onDidDismiss —
     когда уход уже случился. */
  const закрыть = () => { void модалка.current?.dismiss(); };

  /* Смахивание вниз.

     Начинается, только когда тело прокручено в самый верх, — и это не ограничение, а
     единственный способ не отбирать движение у прокрутки. Палец ведёт вниз: если
     список прокручен, человек хочет вернуться к его началу, а не закрыть шторку.
     Дотянул до верха, ведёт дальше — вот теперь это «закрыть».

     На шапке жест работает всегда: она вне прокрутки, спорить не с чем.

     Жест подключается по isOpen, а содержимое держим смонтированным всегда
     (keepContentsMounted). Иначе узлов внутри модалки до конца показа может не быть —
     вешать жест не на что, и первая версия по этой причине не срабатывала вовсе.
     Привязываться к onDidPresent тоже нельзя: если событие не придёт (а в скрытой
     вкладке оно не приходит), шторка останется без жеста и никто не поймёт почему. */
  const включитьЖест = () => {
    if (жест.current) return;
    const кор = оболочка.current;
    const низ = тело.current;
    const шапка = кор?.querySelector('.sheet-head') as HTMLElement | null;
    if (!кор || !низ) return;
    let H = 1;
    let изШапки = false;
    const g = createGesture({
      el: кор,
      gestureName: 'sheet-dismiss',
      direction: 'y',
      threshold: 10,
      canStart: (d) => {
        const цель = d.event.target as HTMLElement | null;
        изШапки = !!(шапка && цель && шапка.contains(цель));
        return начинатьЛи(изШапки, низ.scrollTop, d.deltaY);
      },
      onStart: () => { H = кор.clientHeight || 1; кор.style.transition = 'none'; },
      onMove: (d) => {
        /* Пересчитываем на каждом кадре: движение могло начаться у верха списка, а
           продолжиться после того, как список ушёл вниз. Шторка в этот момент должна
           отпустить движение, иначе она поедет поверх прокрутки. */
        if (!тянемШторку(изШапки, низ.scrollTop)) { кор.style.transform = ''; return; }
        кор.style.transform = `translate3d(0,${сдвиг(d.deltaY)}px,0)`;
      },
      onEnd: (d) => {
        const надоЗакрыть = тянемШторку(изШапки, низ.scrollTop)
          && закрыватьЛи(d.deltaY, H, d.velocityY);
        кор.style.transition = 'transform .2s cubic-bezier(.3,.9,.3,1)';
        кор.style.transform = надоЗакрыть ? `translate3d(0,${H}px,0)` : '';
        /* Закрываем после того, как шторка доехала вниз: снять её посреди движения —
           значит показать рывок вместо ухода. */
        if (надоЗакрыть) window.setTimeout(закрыть, 180);
      },
    });
    g.enable();
    жест.current = g;
  };

  /* Сдвиг снимаем при уходе: шторка живёт в разметке всегда, и в следующий раз она
     открылась бы уже уехавшей вниз. */
  const выключитьЖест = () => {
    жест.current?.destroy();
    жест.current = null;
    const кор = оболочка.current;
    if (кор) { кор.style.transition = ''; кор.style.transform = ''; }
  };

  useEffect(() => {
    if (isOpen) включитьЖест(); else выключитьЖест();
    return выключитьЖест;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <IonModal
      ref={модалка}
      isOpen={isOpen}
      keepContentsMounted
      onDidDismiss={onClose}
      className="sheet-modal"
    >
      <div className="sheet-shell" ref={оболочка}>
        <div className="sheet-head">
          {/* Полоска-ручка: она же подсказка, что шторку можно смахнуть. Без неё жест
              знают только те, кто и так пробует его на всём подряд. */}
          <span className="sheet-grab" aria-hidden />
          {onBack && (
            <button className="sheet-close" onClick={onBack} aria-label="Назад">
              <IonIcon icon={chevronBack} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet-title">{title}</div>
            {subtitle && <div className="sheet-subtitle">{subtitle}</div>}
          </div>
          <button className="sheet-close" onClick={закрыть} aria-label="Закрыть">
            <IonIcon icon={closeOutline} />
          </button>
        </div>
        <div className="sheet-body" ref={тело}>{children}</div>
        {footer}
      </div>
    </IonModal>
  );
}
