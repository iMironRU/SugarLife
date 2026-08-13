import { IonInput } from '@ionic/react';

/* Ввод числа: крупная цифра по центру, «минус» и «плюс» по бокам (SugarLife#203).

   Тот же элемент, что в правке базального профиля, — и это не «похожий вид», а тот же
   способ: там человек уже привык, что число правится по шагу, а не набирается заново.

   ЦИФРА ОСТАЁТСЯ ПОЛЕМ, а не текстом. Степпером нельзя ввести первое значение: 72
   килограмма — это сто сорок четыре нажатия. Поэтому по числу можно ткнуть и набрать
   его с клавиатуры, а ± правит от того, что уже есть. Первый раз — набрал, дальше —
   поправил на полкило.

   Поле — text с числовой клавиатурой, а не number: числовое молча съедает запятую, а
   «7,2» человек наберёт именно так (та же причина, что в шторке глюкометра). */
export default function NumberStepper({
  значение, шаг, единица, подсказка, min = 0, max = Number.MAX_SAFE_INTEGER, знаков = 1, onChange,
}: {
  значение: string;
  шаг: number;
  единица: string;
  подсказка: string;
  min?: number;
  max?: number;
  /** Сколько знаков после запятой оставлять при правке кнопками. */
  знаков?: number;
  onChange: (текст: string) => void;
}) {
  const число = (() => {
    const n = Number(значение.replace(',', '.'));
    return Number.isFinite(n) && значение.trim() !== '' ? n : null;
  })();

  /* Кнопки работают только при введённом числе: прибавлять к пустоте значит выдумать
     за человека начальную точку — вес, давление и HbA1c мы угадывать не вправе. */
  const сдвинуть = (куда: 1 | -1) => {
    if (число == null) return;
    const v = Math.min(max, Math.max(min, +(число + куда * шаг).toFixed(знаков)));
    onChange(String(v).replace('.', ','));
  };

  return (
    <>
      <div className="bas-stepper">
        <button className="bas-pm" disabled={число == null || число <= min}
          onClick={() => сдвинуть(-1)} aria-label="Меньше">−</button>
        <div className="bas-stepval num-field">
          <IonInput type="text" inputmode="decimal" placeholder={подсказка}
            value={значение} onIonInput={(e) => onChange(e.detail.value ?? '')} />
          <small>{единица} · шаг {String(шаг).replace('.', ',')}</small>
        </div>
        <button className="bas-pm" disabled={число == null || число >= max}
          onClick={() => сдвинуть(1)} aria-label="Больше">+</button>
      </div>
    </>
  );
}
