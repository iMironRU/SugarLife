import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { restaurantOutline, warningOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { useUnit } from '../data/units';
import { reportContentScroll } from '../data/panel';
import { useDeviceExtras } from '../data/deviceExtras';
import { reservoirStats } from '../data/treatmentStats';
import FoodSheet from '../components/FoodSheet';

const DASH = '—';

// склонение «приём/приёма/приёмов»
function mealsWord(n: number): string {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 'приём';
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'приёма';
  return 'приёмов';
}

const isPaused = (s?: string | null) => {
  const l = (s || '').toLowerCase();
  return l.includes('приостан') || l.includes('пауза') || l.includes('suspend') || l.includes('stop');
};

export default function Today() {
  const { data } = useStore();
  useUnit(); // перерисовка при смене единиц
  const [foodOpen, setFoodOpen] = useState(false);
  const dev = data?.device || null;

  // общие расширенные данные (грузит панель) — события/резервуар
  const extras = useDeviceExtras();
  const rstat = reservoirStats(extras.devHist);

  // углеводы за сегодня (с локальной полуночи)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todayCarbs = extras.events.filter((e) => (e.carbs ?? 0) > 0 && e.t >= dayStart.getTime());
  const dayCarbs = Math.round(todayCarbs.reduce((a, b) => a + (b.carbs || 0), 0));
  const mealCount = todayCarbs.length;
  const cob = dev?.cob != null ? Math.round(dev.cob) : null;

  // подсветка резервуара: подача идёт, а остаток не меняется
  const stuck = rstat.flatHours > 8 && !isPaused(dev?.status) && (rstat.current ?? 0) > 0;

  return (
    <IonPage>
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen">
          {/* панель углеводов (по макету): Б/Ж/У · активные · Еда.
              Б/Ж пусто — Nightscout не отдаёт белки/жиры, фейк не рисуем. */}
          <button className="carb-panel" onClick={() => setFoodOpen(true)}>
            <div className="carb-macros">
              <div className="carb-macro"><span className="cm-k">Б</span><span className="cm-v">{DASH}</span></div>
              <div className="carb-macro"><span className="cm-k">Ж</span><span className="cm-v">{DASH}</span></div>
              <div className="carb-macro"><span className="cm-k">У</span><span className="cm-v">{dayCarbs}</span><span className="cm-u">г</span></div>
            </div>

            <div className="carb-center">
              <div className="carb-big">{cob != null ? cob : DASH}<span>г</span></div>
              <div className="carb-lbl">активные углеводы</div>
              <div className="carb-sub">всего за день · {dayCarbs} г</div>
            </div>

            <div className="carb-food">
              <IonIcon icon={restaurantOutline} />
              <div className="carb-food-t">Еда</div>
              <div className="carb-food-s">{mealCount} {mealsWord(mealCount)}</div>
            </div>
          </button>

          {/* подсветки резервуара */}
          {stuck && (
            <div className="today-alert warn">
              <IonIcon icon={warningOutline} />
              <div>
                <b>Резервуар не меняется {Math.round(rstat.flatHours)} ч</b>
                <span>А помпа не на паузе — инсулин должен расходоваться. Проверь подачу (окклюзия, катетер, датчик резервуара).</span>
              </div>
            </div>
          )}
        </div>
        <FoodSheet isOpen={foodOpen} onClose={() => setFoodOpen(false)} />
      </IonContent>
    </IonPage>
  );
}
