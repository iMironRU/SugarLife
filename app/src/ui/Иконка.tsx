import { useMemo } from 'react';
import type { CSSProperties } from 'react';

/* Своя иконка вместо IonIcon (#405).

   ЗАЧЕМ. Первый экран тянул 390 КБ, из них 213 — Ionic. При этом `@ionic/react`
   импортировали 57 файлов, и подавляющее большинство — ровно ради одной иконки. Мы платили
   средой выполнения целого фреймворка за то, чтобы нарисовать картинку 16×16.

   Это не про красоту цифр: половина того, что не доезжает по плохой связи, нам не нужна, а
   белый экран после выхода из фона мы уже ловили (#386, #131).

   КАК. `ionicons/icons` отдаёт саму картинку строкой — data-URI с готовым SVG. Ionic
   разбирал её у себя внутри; мы делаем то же самое в четыре строки и вставляем разметку
   как есть. Пакет иконок остаётся, уходит фреймворк вокруг него.

   ПРО `dangerouslySetInnerHTML`. Здесь он безопасен и это проверяемо: строка приходит не
   от человека и не из сети, а из зависимости, вкомпилированной в сборку. Чужого мы сюда не
   пустим — если строка не начинается известным префиксом, не рисуем ничего. */
const ПРЕФИКС = 'data:image/svg+xml;utf8,';

function разметка(icon: string): string | null {
  if (typeof icon !== 'string' || !icon.startsWith(ПРЕФИКС)) return null;
  try {
    return decodeURIComponent(icon.slice(ПРЕФИКС.length));
  } catch {
    /* Строка не декодируется — рисуем пустоту, а не ломаем экран из-за картинки. */
    return null;
  }
}

export default function Иконка({ icon, className, style, title, slot }: {
  /** Значение из `ionicons/icons` — тот же проп, что был у IonIcon: замена без правки мест. */
  icon: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /* `slot` нужен, пока рядом живут кнопки Ionic: они раскладывают содержимое по слотам, и
     без него иконка встала бы не на своё место. Уйдёт вместе с последней такой кнопкой. */
  slot?: string;
}) {
  const svg = useMemo(() => разметка(icon), [icon]);
  if (!svg) return null;
  /* Элемент — `i`, а не `span`, и это не вкусовщина. Стили давно писались в расчёте на то,
     что иконка это `ion-icon`, а не span: есть правила вида «любой span внутри этой строки
     растягивается». Первая же замена на span сломала раскладку ленты приборов — строки
     обрезались на середине слова. `i` в этих правилах не участвует и держит роль значка. */
  return (
    <i className={'иконка' + (className ? ' ' + className : '')} style={style} title={title} slot={slot}
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
