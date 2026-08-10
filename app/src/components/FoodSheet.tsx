import { IonModal, IonContent, IonIcon, IonInput } from '@ionic/react';
import { closeOutline, restaurantOutline, nutritionOutline, searchOutline, removeOutline, addOutline, lockClosed } from 'ionicons/icons';
import { useState } from 'react';
import { useStore, useWritable } from '../data/store';
import { fmt, useCarbUnit, toCarbs, carbUnitLabel, XE_GRAMS } from '@/domain/units';

const DASH = '—';
const MEALS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];

/* Шторка «Еда» (запись приёма пищи) — по макету. Пока ввод в Nightscout не
   настроен (нет токена на запись), сверху честная пометка, а «Сохранить»
   неактивна. Данные (углеводы) реальные из ввода; Б/Ж/ккал — прочерки. */
export default function FoodSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data } = useStore();
  const writable = useWritable();
  const ic = data?.profile?.ic ?? 8;

  const cu = useCarbUnit(); // граммы/Х.Е. — carbs храним в граммах, показываем в выбранных
  const [carbs, setCarbs] = useState(30);
  const [mode, setMode] = useState<'carbs' | 'dish'>('carbs');
  const [meal, setMeal] = useState(1); // Обед по умолчанию

  const mealBolus = carbs > 0 ? fmt(carbs / ic) : '0';
  const step = cu === 'xe' ? XE_GRAMS : 5; // шаг: 1 Х.Е. или 5 г
  const clabel = carbUnitLabel(cu);
  // соотношение углеводы↔инсулин в выбранных единицах
  const ratio = cu === 'xe' ? `1 Х.Е. ≈ ${fmt(XE_GRAMS / ic)} ед` : `КУ 1 ед / ${fmt(ic)} г`;

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

        {/* честная пометка: запись пока недоступна */}
        {!writable && (
          <div className="food-warn">
            <IonIcon icon={lockClosed} />
            <span>Нет токена на запись в Nightscout — приём не сохранится. Пока только просмотр.</span>
          </div>
        )}

        {/* сводка приёма */}
        <div className="food-summary">
          <div className="fs-left">
            <div className="fs-cap">Углеводы</div>
            <div className="fs-carbs">{toCarbs(carbs, cu)}<span>{clabel}</span></div>
          </div>
          <div className="fs-macros">
            <div><span className="fs-mk">Б</span><span className="fs-mv">{DASH}</span></div>
            <div><span className="fs-mk">Ж</span><span className="fs-mv">{DASH}</span></div>
            <div><span className="fs-mk">ккал</span><span className="fs-mv">{DASH}</span></div>
          </div>
        </div>
        <div className="food-bolus">Болюс на еду: {mealBolus} ед · {ratio}</div>

        {/* режим ввода */}
        <div className="food-modes">
          <button className={'food-mode' + (mode === 'carbs' ? ' on' : '')} onClick={() => setMode('carbs')}>
            <IonIcon icon={nutritionOutline} />Углеводами
          </button>
          <button className={'food-mode' + (mode === 'dish' ? ' on' : '')} onClick={() => setMode('dish')}>
            <IonIcon icon={restaurantOutline} />По блюду
          </button>
        </div>

        {/* приём пищи */}
        <div className="food-label">Приём пищи</div>
        <div className="food-meals">
          {MEALS.map((m, i) => (
            <button key={m} className={'food-meal' + (meal === i ? ' on' : '')} onClick={() => setMeal(i)}>{m}</button>
          ))}
        </div>

        {/* ввод углеводов / поиск блюда */}
        {mode === 'carbs' ? (
          <div className="food-stepper">
            <span>Углеводы</span>
            <div className="stepper">
              <button onClick={() => setCarbs((c) => Math.max(0, c - step))}><IonIcon icon={removeOutline} /></button>
              <b>{toCarbs(carbs, cu)}<i>{clabel}</i></b>
              <button onClick={() => setCarbs((c) => Math.min(300, c + step))}><IonIcon icon={addOutline} /></button>
            </div>
          </div>
        ) : (
          <>
            <div className="food-label">Блюдо</div>
            <div className="field" aria-disabled="true" style={{ opacity: 0.6 }}>
              <IonIcon icon={searchOutline} className="field-ico" />
              <IonInput placeholder="Найти блюдо" disabled />
            </div>
            <div className="metric-note">Каталог блюд появится позже.</div>
          </>
        )}

        {/* сохранить — неактивна пока нет записи в Nightscout */}
        <button className="food-save" disabled>Сохранить приём</button>
        {!writable && <div className="food-save-note">Кнопка станет активной, когда добавим токен на запись и ввод еды.</div>}
      </IonContent>
    </IonModal>
  );
}
