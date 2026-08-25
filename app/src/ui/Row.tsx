import Иконка from './Иконка';
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
   быть ни фокуса, ни отклика на нажатие.

   Два исключения потребовали пропсов, и оба про семантику, а не про вид:
   href — это настоящая ссылка (скачать сборку), её должно быть видно как ссылку
   браузеру и читалке экрана; right — своё содержимое справа вместо шеврона там,
   где строка не ведёт дальше, а показывает состояние (галочка выбранного,
   переключатель настройки). */
export default function Row({ icon, title, sub, value, valueMuted, chevron = true, onClick, href, right, disabled, titleMuted, oneLine, className, бейдж }: {
  icon?: string;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueMuted?: boolean;
  chevron?: boolean;
  onClick?: () => void;
  /** внешняя ссылка — тот же вид, но настоящий <a> для браузера и читалки экрана */
  href?: string;
  /** своё содержимое справа вместо шеврона: галочка, переключатель */
  right?: ReactNode;
  disabled?: boolean;
  titleMuted?: boolean;
  /** длинный текст (адрес сайта) — в одну строку с многоточием вместо переноса */
  oneLine?: boolean;
  className?: string;
  /* СКОЛЬКО ЗДЕСЬ КРАСНОГО (#523). Цифра отвечает на «где искать беду»: без неё список выглядит
     одинаково спокойным и когда всё в порядке, и когда ночью нас не услышат.

     Ноль сюда не передают — отсутствие значка и есть «всё в порядке»; «0» в кружке читается как
     «что-то есть, но ноль» и заставляет открывать раздел зря. */
  бейдж?: number;
}) {
  const tcls = 'list-title' + (titleMuted ? ' muted' : '') + (oneLine ? ' one-line' : '');
  const cls = 'list-row' + (className ? ' ' + className : '');

  const inner = (
    <>
      {icon && <Иконка icon={icon} className="list-ico" />}
      {sub ? (
        <span className="pick-main">
          <span className={tcls}>{title}</span>
          <span className="pick-sub">{sub}</span>
        </span>
      ) : (
        <span className={tcls}>{title}</span>
      )}
      {бейдж != null && бейдж > 0 && <span className="list-бейдж">{бейдж}</span>}
      {value != null && <span className={'list-value' + (valueMuted ? ' muted' : '')}>{value}</span>}
      {right}
      {!right && (onClick || href) && chevron && <Иконка icon={chevronForward} className="list-chev" />}
    </>
  );

  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer">{inner}</a>;
  return onClick
    ? <button className={cls} onClick={onClick} disabled={disabled}>{inner}</button>
    : <div className={cls} style={{ cursor: 'default' }}>{inner}</div>;
}
