import { useState } from 'react';
import { IonIcon, IonInput } from '@ionic/react';
import { checkmarkCircle, trashOutline } from 'ionicons/icons';
import Sheet from '@/ui/Sheet';
import { updateMeal, deleteMeal } from '@/sources/mealStore';
import type { Meal } from '@/domain/meals';
import { ВИДЫ, имяПриёма } from '@/domain/имяПриёма';
import { toCarbs, carbUnitLabel, getCarbUnit, XE_GRAMS } from '@/domain/units';

/* Правка приёма (SugarLife#381).

   Единственным действием в строке журнала была корзина: ошибся в граммах — стирай и
   вноси заново. Это не только неудобно, это теряет запись целиком: время внесения, id и
   вместе с ними идемпотентность доставки.

   ЧТО ЗДЕСЬ ПРАВИТСЯ: граммы, время и тип. Тип — потому что наша догадка о том, обед это
   или перекус, остаётся догадкой: у работающего в ночь «завтрак» в восемь вечера, и
   спорить с ним об этом приложению не по чину.

   Время правится ЧАСАМИ И МИНУТАМИ, а не «полчаса назад»: от времени еды считается вся
   кривая активных углеводов, и человек, который вносит задним числом, помнит именно час,
   а не смещение. */
export default function MealEditSheet({ приём, onClose }: { приём: Meal; onClose: () => void }) {
  const cu = getCarbUnit();
  const [углеводы, setУглеводы] = useState(String(toCarbs(приём.carbs, cu)));
  const [время, setВремя] = useState(() => {
    const д = new Date(приём.t);
    return `${String(д.getHours()).padStart(2, '0')}:${String(д.getMinutes()).padStart(2, '0')}`;
  });
  const [вид, setВид] = useState<string>(приём.kind ?? '');
  const [занят, setЗанят] = useState(false);

  const число = Number((углеводы || '').replace(',', '.'));
  const годно = Number.isFinite(число) && число > 0 && /^\d{1,2}:\d{2}$/.test(время);
  /* Обратно в граммы: хранение всегда в граммах, Х.Е. — только представление
     (domain/meals). Записав «2 Х.Е.», мы навсегда потеряли бы, сколько это граммов. */
  const граммы = годно ? (cu === 'xe' ? число * XE_GRAMS : число) : приём.carbs;
  /* Предположение показываем прямо в списке типов — как выбранное по умолчанию, но не
     навязанное: человек видит, что мы думаем, и может не согласиться одним касанием. */
  const догадка = имяПриёма(new Date(приём.t).getHours(), граммы);

  const сохранить = async () => {
    if (!годно) return;
    setЗанят(true);
    const [ч, м] = время.split(':').map(Number);
    const когда = new Date(приём.t);
    когда.setHours(ч, м, 0, 0);
    await updateMeal(приём, {
      t: когда.getTime(),
      carbs: граммы,
      /* Пустой выбор — значит «пусть решает правило»: не записываем догадку в данные,
         иначе завтра она станет фактом, который никто не выбирал. */
      kind: вид || undefined,
    });
    setЗанят(false);
    onClose();
  };

  const удалить = async () => {
    if (!window.confirm('Удалить этот приём? Углеводы перестанут учитываться в активных.')) return;
    await deleteMeal(приём.id);
    onClose();
  };

  return (
    <Sheet isOpen onClose={onClose} title="Приём пищи" subtitle="правка записи">
      <div className="param">
        <div className="field-label">Углеводы, {carbUnitLabel(cu)}</div>
        <div className="field">
          <IonInput value={углеводы} inputmode="decimal"
            onIonInput={(e) => setУглеводы(e.detail.value ?? '')} />
        </div>
      </div>

      <div className="param">
        <div className="field-label">Когда ели</div>
        <div className="field">
          <IonInput value={время} inputmode="numeric"
            onIonInput={(e) => setВремя(e.detail.value ?? '')} placeholder="13:20" />
        </div>
        <div className="field-hint param-hint">
          От времени еды считаются активные углеводы — если вносили задним числом,
          поправьте час.
        </div>
      </div>

      <div className="param">
        <div className="field-label">Что это было</div>
        <div className="period период-виды">
          <button className={'period-seg' + (вид === '' ? ' on' : '')} onClick={() => setВид('')}>
            {догадка.toLowerCase()} · само
          </button>
          {ВИДЫ.map((в) => (
            <button key={в} className={'period-seg' + (вид === в ? ' on' : '')} onClick={() => setВид(в)}>
              {в.toLowerCase()}
            </button>
          ))}
        </div>
        <div className="field-hint param-hint">
          «Само» — приложение назовёт по времени и размеру. На расчёты это не влияет
          никак: доза считается от граммов и времени.
        </div>
      </div>

      <button className="food-save" disabled={!годно || занят} onClick={() => void сохранить()}
        style={{ marginTop: 14 }}>
        <IonIcon icon={checkmarkCircle} style={{ marginRight: 6, verticalAlign: -2 }} />
        {занят ? 'Сохраняю…' : 'Сохранить'}
      </button>

      <button className="ob-skip" style={{ marginTop: 12 }} onClick={() => void удалить()}>
        <IonIcon icon={trashOutline} style={{ marginRight: 6, verticalAlign: -2 }} />
        Удалить приём
      </button>
    </Sheet>
  );
}
