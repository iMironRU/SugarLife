import { IonIcon } from '@ionic/react';
import { chevronForward } from 'ionicons/icons';
import type { ReactNode } from 'react';

/* Строка списка — 34 повторения в восьми файлах, и все с одной и той же анатомией:
   иконка · заголовок (иногда с подписью) · значение справа · шеврон.

   Различия между копиями были не смысловые, а случайные: где-то заголовок обёрнут
   в .pick-main ради подписи, где-то нет; где-то шеврон есть, где-то забыт при том,
   что строка ведёт дальше. Отсюда и разъезжались мелочи — в одном списке строка
   с переходом со стрелкой, в соседнем такая же без.

   Шеврон по умолчанию есть у нажимаемой строки, потому что почти все они ведут
   вглубь. Но не все: «Добавить облако» и «Экспорт в CSV» — это действия, а не
   переход, и стрелка там врала бы, обещая следующий экран. Для них chevron={false}.

   Строку без действия рисуем как div, а не как отключённую кнопку: у неё не должно
   быть ни фокуса, ни отклика на нажатие. */
export default function Row({ icon, title, sub, value, valueMuted, chevron = true, onClick, disabled, titleMuted, oneLine, className }: {
  icon?: string;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueMuted?: boolean;
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  titleMuted?: boolean;
  /** длинный текст (адрес сайта) — в одну строку с многоточием вместо переноса */
  oneLine?: boolean;
  className?: string;
}) {
  const tcls = 'list-title' + (titleMuted ? ' muted' : '') + (oneLine ? ' one-line' : '');
  const cls = 'list-row' + (className ? ' ' + className : '');

  const inner = (
    <>
      {icon && <IonIcon icon={icon} className="list-ico" />}
      {sub ? (
        <span className="pick-main">
          <span className={tcls}>{title}</span>
          <span className="pick-sub">{sub}</span>
        </span>
      ) : (
        <span className={tcls}>{title}</span>
      )}
      {value != null && <span className={'list-value' + (valueMuted ? ' muted' : '')}>{value}</span>}
      {onClick && chevron && <IonIcon icon={chevronForward} className="list-chev" />}
    </>
  );

  return onClick
    ? <button className={cls} onClick={onClick} disabled={disabled}>{inner}</button>
    : <div className={cls} style={{ cursor: 'default' }}>{inner}</div>;
}
