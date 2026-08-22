import { useEffect, useRef, useState } from 'react';

/* ПОЛЕ ВВОДА — своё, вместо `IonInput` (SugarLife#405).

   ЧЕГО ЗДЕСЬ БОЯЛИСЬ. У `IonInput` внутри обычный `<input>` и обвязка вокруг: своя тень, свои
   события `ionInput`/`ionChange` и правка поведения клавиатуры на iOS. Терять последнее нельзя молча,
   поэтому обвязку мы не копируем, а СВОДИМ К ТОМУ, чем пользовались: значение, подсказка, тип,
   `inputmode` и событие ввода. Всё остальное было не нужно.

   ЗНАЧЕНИЕ ИЗВНЕ, НО КУРСОР НЕ ТРОГАЕМ. Управляемое поле в React переставляет курсор в конец, когда
   значение приходит извне на каждый ввод, — на телефоне это выглядит как «печатает задом наперёд».
   Поэтому держим своё состояние и подхватываем внешнее, только если оно и правда изменилось.

   iOS И ЗУМ ПРИ ФОКУСЕ. Safari увеличивает страницу, если у поля шрифт меньше 16 px. Размер задаётся
   в CSS (`.поле`), и меньше 1rem его ставить нельзя — иначе экран будет прыгать при каждом касании. */
export default function Поле({
  value, onInput, placeholder, type = 'text', inputmode, disabled, className, autoFocus, onEnter, ariaLabel,
  onFocus, onBlur,
}: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'time' | 'password' | 'url';
  inputmode?: 'text' | 'numeric' | 'decimal' | 'url' | 'email';
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  ariaLabel?: string;
  /* Фокус отдаём элементом, а не событием: единственный, кому он нужен, подтягивает поле над
     клавиатурой (sheets/FoodSheet.tsx), и ему нужен сам узел. */
  onFocus?: (el: HTMLInputElement) => void;
  onBlur?: () => void;
}) {
  const [своё, setСвоё] = useState(value);
  const последнее = useRef(value);
  useEffect(() => {
    if (value !== последнее.current) { последнее.current = value; setСвоё(value); }
  }, [value]);

  return (
    <input
      className={`поле${className ? ` ${className}` : ''}`}
      type={type}
      inputMode={inputmode}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      value={своё}
      onChange={(e) => {
        const v = e.target.value;
        последнее.current = v;
        setСвоё(v);
        onInput(v);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
      onFocus={(e) => onFocus?.(e.currentTarget)}
      onBlur={() => onBlur?.()}
    />
  );
}
