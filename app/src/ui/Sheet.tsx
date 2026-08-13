import { IonModal, IonIcon, createGesture } from '@ionic/react';
import { closeOutline, chevronBack } from 'ionicons/icons';
import { useEffect, useRef, type ReactNode } from 'react';
import { закрыватьЛи, сдвиг } from './sheetGesture';

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
  const оболочка = useRef<HTMLDivElement>(null);
  const шапка = useRef<HTMLDivElement>(null);

  /* Смахивание вниз — жест только на шапке. Почему не штатным способом Ionic и почему
     именно шапка — в ui/sheetGesture.ts; коротко: их смахивание включается вместе с
     breakpoints, а те забирают вертикальный жест целиком и ломают прокрутку тела. */
  useEffect(() => {
    const el = шапка.current;
    const кор = оболочка.current;
    if (!isOpen || !el || !кор) return;
    let H = 1;
    const жест = createGesture({
      el,
      gestureName: 'sheet-dismiss',
      direction: 'y',
      threshold: 8,
      onStart: () => { H = кор.clientHeight || 1; кор.style.transition = 'none'; },
      onMove: (d) => { кор.style.transform = `translate3d(0,${сдвиг(d.deltaY)}px,0)`; },
      onEnd: (d) => {
        const закрыть = закрыватьЛи(d.deltaY, H, d.velocityY);
        кор.style.transition = 'transform .2s cubic-bezier(.3,.9,.3,1)';
        кор.style.transform = закрыть ? `translate3d(0,${H}px,0)` : '';
        /* Закрываем после того, как шторка доехала вниз: снять её посреди движения —
           значит показать рывок вместо ухода. Ровно как со страницами разделов. */
        if (закрыть) window.setTimeout(onClose, 180);
      },
    });
    жест.enable();
    return () => {
      жест.destroy();
      /* Сдвиг снимаем при закрытии: шторка живёт в разметке всегда, и в следующий раз
         она открылась бы уже уехавшей вниз. */
      кор.style.transition = '';
      кор.style.transform = '';
    };
  }, [isOpen, onClose]);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="sheet-modal">
      <div className="sheet-shell" ref={оболочка}>
        <div className="sheet-head" ref={шапка}>
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
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
            <IonIcon icon={closeOutline} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer}
      </div>
    </IonModal>
  );
}
