import { IonIcon } from '@ionic/react';
import { useState } from 'react';
import { restaurantOutline, cloudOutline, trashOutline } from 'ionicons/icons';
import PageHead from '@/ui/PageHead';
import { useStore } from '@/sources/store';
import { useMeals, deleteMeal } from '@/sources/mealStore';
import { useCarbUnit, toCarbs, carbUnitLabel, plural } from '@/domain/units';
import { onlyLocal } from '@/domain/meals';

/* Журнал приёмов.

   Раньше внесённую еду негде было увидеть: на «Сегодня» только сумма за день. Человек
   внёс приём и не мог проверить ни что он записался, ни с каким временем — а время мы
   как раз просим указывать точно, потому что от него считаются активные углеводы.
   Просить точность и не показывать результат — нечестно.

   Показываем ОБА источника вместе: свои записи и углеводы из Nightscout. Разделять их
   в списке незачем — человек ел один раз, а откуда об этом узнали, это наша кухня.
   Но пометку источника оставляем: удалить можно только своё, чужое приедет снова.

   Сутки по умолчанию: столько живут активные углеводы и столько человек помнит, что
   ел. Неделя — по запросу, для разбора. */

const ЧАС = 3600e3;

export default function MealsSection({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const meals = useMeals();
  const cu = useCarbUnit();
  const [окно, setОкно] = useState<24 | 168>(24);

  const от = Date.now() - окно * ЧАС;
  const свои = onlyLocal(meals, data?.treatments ?? [])
    .filter((m) => m.t >= от)
    .map((m) => ({ id: m.id, t: m.t, carbs: m.carbs, kind: m.kind, своё: true }));
  const облачные = (data?.treatments ?? [])
    .filter((t) => (t.carbs ?? 0) > 0 && t.t >= от)
    .map((t) => ({ id: 'ns' + t.t, t: t.t, carbs: t.carbs as number, kind: t.type, своё: false }));

  const все = [...свои, ...облачные].sort((a, b) => b.t - a.t);
  const сумма = Math.round(все.reduce((s, x) => s + x.carbs, 0));

  return (
    <div className="sheet stack-body">
      <PageHead title="Приёмы пищи"
        subtitle={все.length
          ? `${все.length} ${plural(все.length, 'приём', 'приёма', 'приёмов')} · ${toCarbs(сумма, cu)} ${carbUnitLabel(cu)}`
          : 'Пока пусто'}
        onBack={onClose} />

      <div className="period">
        <button className={'period-seg' + (окно === 24 ? ' on' : '')} onClick={() => setОкно(24)}>Сутки</button>
        <button className={'period-seg' + (окно === 168 ? ' on' : '')} onClick={() => setОкно(168)}>Неделя</button>
      </div>

      {все.length === 0 ? (
        <div className="loop-empty">
          <IonIcon icon={restaurantOutline} />
          <div className="loop-empty-t">Записей нет</div>
          <div className="loop-empty-s">
            Ни в приложении, ни в Nightscout за этот период. Внести приём можно с экрана
            «Сегодня» — плитка углеводов.
          </div>
        </div>
      ) : (
        <div className="meal-log">
          {все.map((x) => (
            <div key={x.id} className="meal-row">
              <div className="meal-when">
                <b>{время(x.t)}</b>
                <span>{день(x.t)}</span>
              </div>
              <div className="meal-what">
                <b>{toCarbs(x.carbs, cu)} {carbUnitLabel(cu)}</b>
                <span>
                  {x.kind || 'приём'}
                  {!x.своё && <> · <IonIcon icon={cloudOutline} /> Nightscout</>}
                </span>
              </div>
              {/* Удалить можно только своё: облачное приедет снова при следующем
                  обновлении, и кнопка, которая ничего не меняет, хуже её отсутствия. */}
              {x.своё && (
                <button className="meal-del" onClick={() => deleteMeal(x.id)} aria-label="Удалить">
                  <IonIcon icon={trashOutline} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const время = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const день = (t: number) => {
  const d = new Date(t), сегодня = new Date();
  if (d.toDateString() === сегодня.toDateString()) return 'сегодня';
  сегодня.setDate(сегодня.getDate() - 1);
  if (d.toDateString() === сегодня.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};
