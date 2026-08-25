import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* МОДАЛКА — своя, вместо `IonModal` (SugarLife#405).

   ОДИН ПУТЬ ЗАКРЫТИЯ, И ЭТО ГЛАВНОЕ. У Ionic крестик закрывал мгновенно (родитель дёргал состояние),
   а тап по затемнению — с уходом вниз (штатный dismiss). Одно действие, два разных вида. Поэтому и
   здесь наружу мы сообщаем ПОСЛЕ ухода: `dismiss()` запускает анимацию, `onClose` зовётся, когда она
   кончилась. Кто бы ни закрыл — крестик, затемнение, клавиша или жест, — путь один.

   СОДЕРЖИМОЕ ОСТАЁТСЯ СМОНТИРОВАННЫМ, пока шторка открыта: жест шторки вешается на её узлы, и если
   снимать их раньше времени, вешать становится не на что (у Ionic это звалось `keepContentsMounted`).

   ЗАКРЫТУЮ НЕ ДЕРЖИМ В ДЕРЕВЕ ВОВСЕ. Ionic прятал закрытые модалки классом, и однажды наш стиль
   переспорил его: невидимая коробка легла поверх приложения, и интерфейс перестал нажиматься целиком,
   выглядя при этом нормально. Нет узла — нет и такой поломки.

   ESC — не украшение для настольного браузера: приложение открывают и с ноутбука, а шторка без
   клавиатурного выхода там ловушка. */

export interface УправлениеМодалкой { dismiss(): void }

const УХОД_МС = 220;

const Модалка = forwardRef<УправлениеМодалкой, {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}>(function Модалка({ isOpen, onClose, className, children }, ref) {
  const [видна, setВидна] = useState(false);
  const [уходит, setУходит] = useState(false);
  const таймер = useRef<number | null>(null);

  const закрыть = () => {
    if (уходит) return;
    setУходит(true);
    таймер.current = window.setTimeout(() => {
      setУходит(false);
      setВидна(false);
      onClose();
    }, УХОД_МС);
  };

  useImperativeHandle(ref, () => ({ dismiss: закрыть }));

  useEffect(() => {
    if (isOpen) { setВидна(true); setУходит(false); }
    else if (!уходит) setВидна(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => () => { if (таймер.current) window.clearTimeout(таймер.current); }, []);

  useEffect(() => {
    if (!видна) return;
    const поКлавише = (e: KeyboardEvent) => { if (e.key === 'Escape') закрыть(); };
    window.addEventListener('keydown', поКлавише);
    return () => window.removeEventListener('keydown', поКлавише);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [видна]);

  if (!видна) return null;

  return createPortal(
    <div className={`модалка${уходит ? ' уходит' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true">
      {/* Затемнение — отдельный слой, а не фон коробки: коробка на время ухода держит прежнюю
          высоту, и крашеная коробка показывала бы это чёрной плитой поверх экрана. */}
      <div className="модалка-затемнение" onClick={закрыть} />
      <div className="модалка-тело">{children}</div>
    </div>,
    document.body,
  );
});

export default Модалка;
