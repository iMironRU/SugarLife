import { IonPage, IonContent } from '@ionic/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { reportContentScroll } from '@/app/panel';
import { useTab } from '@/app/nav';

/* Оболочка вкладки — единственное место, где вкладка становится страницей.

   Раньше каждый из пяти экранов писал это сам:

     <IonPage><IonContent fullscreen forceOverscroll scrollEvents
       onIonScroll={reportContentScroll}><div className="screen screen-pad">

   Четыре пропса и два класса, скопированные пять раз. Забыть onIonScroll — панель на
   этом экране перестанет сворачиваться; забыть screen-pad — содержимое встанет на
   восемь пикселей выше, чем у соседей. Ровно это и случилось (SugarLife#159): отступ
   под панелью разошёлся между вкладками вдвое, потому что правило существовало только
   в виде образца для копирования.

   Здесь оно существует физически. Экран описывает содержимое и больше ничего: ни
   прокрутку, ни отступы, ни то, как он становится страницей.

   Отступ сверху задаёт CSS одной величиной (--sl-content-top в theme/parts/shell.css),
   общей со страницами стека и шторками. Первые блоки своих margin-top не приносят —
   иначе зазор снова начнёт складываться из чужих полей. */
export default function Screen({ tab, children }: { tab: number; children: ReactNode }) {
  const active = useTab();
  const ref = useRef<HTMLIonContentElement>(null);

  /* Уходя с экрана, возвращаем его к покою.

     Карусель держит все пять вкладок смонтированными, и каждая помнила свою
     прокрутку — а панель следует за прокруткой активной. Из-за этого вкладки
     выглядели по-разному: на одной панель развёрнута, на другой уже сжата, хотя
     человек ничего с ней не делал. Сравнить это можно только скриншотами, а
     почувствовать — как «приложение каждый раз немного другое».

     Цена решения названа честно: прокрутил длинные «Метрики», ушёл и вернулся —
     ищешь место заново. Мы выбрали предсказуемость: одинаковый вид всех вкладок
     важнее сохранённого места на одной из них. */
  useEffect(() => {
    if (active === tab) return;
    void ref.current?.scrollToTop(0);
  }, [active, tab]);

  return (
    <IonPage>
      <IonContent ref={ref} fullscreen forceOverscroll scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen">{children}</div>
      </IonContent>
    </IonPage>
  );
}
