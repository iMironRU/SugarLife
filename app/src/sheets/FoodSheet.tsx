import { IonModal, IonContent, IonIcon, IonInput } from '@ionic/react';
import { closeOutline, nutritionOutline, removeOutline, addOutline, timeOutline, waterOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '@/sources/store';
import { fmt, useCarbUnit, toCarbs, carbUnitLabel, XE_GRAMS } from '@/domain/units';
import { addMeal } from '@/sources/mealStore';
import { СМЕЩЕНИЯ } from '@/domain/meals';

const MEALS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];

/* Внести приём пищи.

   Кнопка «Сохранить» больше не заблокирована отсутствием токена. Раньше она ждала
   права записи в Nightscout — то есть ввод еды зависел от чужого сервера, и без него
   человек не мог записать даже себе. Теперь приём ложится в свою базу сразу и живёт
   там; куда он поедет дальше — вопрос доставки, а не ввода (domain/meals.ts).

   Время спрашиваем. Активные углеводы считаются от момента ЕДЫ, и «съел полчаса назад»,
   записанное как «сейчас», сдвигает всю кривую вместе с расчётом дозы. Поэтому рядом
   быстрые смещения: это один тап, а не выбор даты в календаре.

   Дозу не подставляем в поле. Прикидку болюса показываем — она полезна, — но вписать
   её за человека значит принять решение о дозе за него. */
export default function FoodSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data } = useStore();
  const ic = data?.profile?.ic ?? 8;

  const cu = useCarbUnit();
  const [carbs, setCarbs] = useState(30);
  const [назад, setНазад] = useState(0); // сколько минут назад ели
  const [meal, setMeal] = useState(1);
  const [insulin, setInsulin] = useState('');
  const [сохранено, setСохранено] = useState(false);

  // открыли заново — начинаем с чистого листа, а не с прошлых цифр
  useEffect(() => { if (isOpen) { setCarbs(30); setНазад(0); setInsulin(''); setСохранено(false); } }, [isOpen]);

  const mealBolus = carbs > 0 ? fmt(carbs / ic) : '0';
  const step = cu === 'xe' ? XE_GRAMS : 5;
  const clabel = carbUnitLabel(cu);
  const ratio = cu === 'xe' ? `1 Х.Е. ≈ ${fmt(XE_GRAMS / ic)} ед` : `КУ 1 ед / ${fmt(ic)} г`;

  const дозаЧисло = Number(insulin.replace(',', '.'));
  const доза = insulin.trim() !== '' && Number.isFinite(дозаЧисло) && дозаЧисло > 0 ? дозаЧисло : undefined;
  const годно = carbs > 0 || доза != null;

  const сохранить = async () => {
    if (!годно) return;
    await addMeal({
      t: Date.now() - назад * 60e3,
      carbs,
      insulin: доза,
      kind: MEALS[meal],
    });
    setСохранено(true);
    window.setTimeout(onClose, 700); // дать увидеть подтверждение, а не захлопнуть
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.9} breakpoints={[0, 0.9]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Еда</div>
            <div className="sheet-subtitle">Запись приёма пищи</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <div className="food-summary">
          <div className="fs-left">
            <div className="fs-cap">Углеводы</div>
            <div className="fs-carbs">{toCarbs(carbs, cu)}<span>{clabel}</span></div>
          </div>
          <div className="fs-macros">
            <div><span className="fs-mk">Б</span><span className="fs-mv">—</span></div>
            <div><span className="fs-mk">Ж</span><span className="fs-mv">—</span></div>
            <div><span className="fs-mk">ккал</span><span className="fs-mv">—</span></div>
          </div>
        </div>
        <div className="food-bolus">Болюс на еду: {mealBolus} ед · {ratio}</div>

        <div className="food-label">Приём пищи</div>
        <div className="food-meals">
          {MEALS.map((m, i) => (
            <button key={m} className={'food-meal' + (meal === i ? ' on' : '')} onClick={() => setMeal(i)}>{m}</button>
          ))}
        </div>

        <div className="food-stepper">
          <span><IonIcon icon={nutritionOutline} /> Углеводы</span>
          <div className="stepper">
            <button onClick={() => setCarbs((c) => Math.max(0, c - step))} aria-label="Меньше"><IonIcon icon={removeOutline} /></button>
            <b>{toCarbs(carbs, cu)}<i>{clabel}</i></b>
            <button onClick={() => setCarbs((c) => Math.min(300, c + step))} aria-label="Больше"><IonIcon icon={addOutline} /></button>
          </div>
        </div>

        {/* Когда ели. Спрашиваем всегда: от этого времени считаются активные углеводы,
            и запись задним числом — обычное дело, а не исключение. */}
        <div className="food-label"><IonIcon icon={timeOutline} /> Когда ели</div>
        <div className="food-meals">
          {СМЕЩЕНИЯ.map((с) => (
            <button key={с.label} className={'food-meal' + (назад === с.ms / 60e3 ? ' on' : '')}
              onClick={() => setНазад(с.ms / 60e3)}>
              {с.ms === 0 ? с.label : с.label + ' назад'}
            </button>
          ))}
        </div>

        {/* Дозу вводит человек. Прикидка выше — подсказка, а не подставленное значение:
            вписать её за него значит принять решение о дозе за него. */}
        <div className="food-label"><IonIcon icon={waterOutline} /> Болюс, ед — если уже вводили</div>
        <div className="field">
          <IonInput value={insulin} type="text" inputmode="decimal" placeholder="не вводили"
            onIonInput={(e) => setInsulin(e.detail.value ?? '')} />
        </div>

        <button className="food-save" disabled={!годно || сохранено} onClick={сохранить}>
          {сохранено ? 'Записано' : 'Сохранить приём'}
        </button>
        <div className="food-save-note">
          Записывается в приложение и учитывается сразу. В Nightscout пока не уходит —
          выгрузку сделаем отдельно, запись от этого не потеряется.
        </div>
      </IonContent>
    </IonModal>
  );
}
