import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

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

export interface StackApi {
  push: (node: ReactNode) => void;
  pop: () => void;
  depth: number;
}

const Ctx = createContext<StackApi>({ push: () => {}, pop: () => {}, depth: 0 });

export const useStack = (): StackApi => useContext(Ctx);

export function StackHost({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<{ key: number; node: ReactNode }[]>([]);

  const push = useCallback((node: ReactNode) => {
    setPages((p) => [...p, { key: (p[p.length - 1]?.key ?? 0) + 1, node }]);
  }, []);
  const pop = useCallback(() => setPages((p) => p.slice(0, -1)), []);

  const api = useMemo<StackApi>(() => ({ push, pop, depth: pages.length }), [push, pop, pages.length]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {pages.map((p, i) => (
        /* Ниже верхней страницы всё скрыто: рисовать нижние незачем, а вот держать
           их смонтированными нужно — иначе возврат терял бы состояние (набранный
           адрес, раскрытую часть суток, правку профиля). */
        <div key={p.key} className={'stack-page' + (i === pages.length - 1 ? ' is-top' : '')} aria-hidden={i !== pages.length - 1}>
          {p.node}
        </div>
      ))}
    </Ctx.Provider>
  );
}
