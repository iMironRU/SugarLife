/* Активная вкладка для карусели (свайп между экранами). Заменяет роутинг табов:
   один индекс 0..4, оба — карусель и панель — читают его. Хэш синхронизируем
   для дип-линков (#/today и т.п.), но без реального роутера. */
import { useEffect, useSyncExternalStore } from 'react';

export const TAB_PATHS = ['/metrics', '/mon', '/today', '/ins', '/profile'];
const DEFAULT = 2; // «Сегодня»

function fromHash(): number {
  try {
    const i = TAB_PATHS.indexOf(location.hash.replace(/^#/, ''));
    return i >= 0 ? i : DEFAULT;
  } catch { return DEFAULT; }
}

let index = fromHash();
const subs = new Set<() => void>();

export function setTab(i: number): void {
  const n = Math.max(0, Math.min(TAB_PATHS.length - 1, i));
  if (n === index) return;
  index = n;
  try { history.replaceState(null, '', '#' + TAB_PATHS[n]); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function getTab(): number { return index; }

/* Нажатие на кнопку таб-бара — не то же самое, что смена вкладки.

   Внутри вкладки живёт стек страниц (Профиль → Устройства → карточка помпы), и
   вкладку можно покинуть свайпом, а потом вернуться — стек при этом сохраняется
   намеренно: человек ожидает застать то место, где был.

   Но если он тычет в ту же вкладку, на которой уже стоит, единственное осмысленное
   значение этого нажатия — «домой»: вернуться в корень раздела. Так устроен любой
   таб-бар, и без этого из «Аналитики» некуда было выйти, кроме кнопки «назад». */
let домойСчёт = 0;
let домойВкладка = -1;
const домойПодписки = new Set<() => void>();

export function pressTab(i: number): void {
  const n = Math.max(0, Math.min(TAB_PATHS.length - 1, i));
  if (n === index) {
    домойВкладка = n;
    домойСчёт++;
    домойПодписки.forEach((f) => f());
    return;
  }
  setTab(n);
}

/** Счётчик запросов «вернуться в корень». Меняется — значит нажали свою вкладку. */
export function useGoHome(myTab: number): number {
  const seq = useSyncExternalStore(
    (cb) => { домойПодписки.add(cb); return () => { домойПодписки.delete(cb); }; },
    () => домойСчёт,
    () => домойСчёт,
  );
  return домойВкладка === myTab ? seq : 0;
}

export function useTab(): number {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => index,
  );
}

/* Закрыть шторки при уходе с вкладки. Карусель держит все панели
   смонтированными и не шлёт ionViewWillLeave, поэтому чистим вручную:
   как только активная вкладка не наша — зовём переданные close-функции
   (для закрытой шторки это no-op). */
export function useCloseOnLeave(myTab: number, ...closers: Array<() => void>): void {
  const tab = useTab();
  useEffect(() => {
    if (tab !== myTab) closers.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, myTab]);
}

/* Имена вкладок — для крошки в разделах под ними (#311).

   Здесь, а не в Screen.tsx: там это был бы второй экспорт рядом с компонентом, и
   горячая перезагрузка перестала бы работать для всех экранов сразу. И здесь же им
   место по смыслу — файл и так про вкладки. Порядок тот же, что у нижней панели. */
export const ИМЕНА_ВКЛАДОК = ['Метрики', 'НМГ', 'Сегодня', 'Инсулин', 'Профиль'];
