import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { restaurantOutline, warningOutline, moonOutline, pauseCircleOutline, batteryDeadOutline } from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { useUnit, useCarbUnit, toCarbs, carbUnitLabel } from '../data/units';
import { reportContentScroll } from '../data/panel';
import { useDeviceExtras } from '../data/deviceExtras';
import { reservoirStats } from '../data/treatmentStats';
import { useCloseOnLeave } from '../data/nav';
import { notify } from '../data/notify';
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
  const cu = useCarbUnit(); // единицы углеводов (граммы/Х.Е.)
  const [foodOpen, setFoodOpen] = useState(false);
  useCloseOnLeave(2, () => setFoodOpen(false)); // «Сегодня» — закрыть «Еду» при уходе
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

  // авторитетный флаг паузы (AAPS pump.extended.PumpSuspended), если известен —
  // иначе фолбэк на текстовую эвристику по статусу
  const paused = dev?.suspended ?? isPaused(dev?.status);

  // подсветка резервуара: подача идёт, а остаток не меняется
  const stuck = rstat.flatHours > 8 && !paused && (rstat.current ?? 0) > 0;

  // «ночное окончание»: если резервуара < 14 ч и он закончится в ночь (23:00–08:00) —
  // рекомендуем заменить заранее, чтобы подача не прервалась во сне. Оценка (≈).
  const reservoir = dev?.reservoir ?? rstat.current ?? null;
  const hoursLeft = reservoir != null && extras.tdd ? reservoir / (extras.tdd / 24) : null;
  let nightEmpty: Date | null = null;
  if (hoursLeft != null && hoursLeft > 0 && hoursLeft < 14) {
    const e = new Date(Date.now() + hoursLeft * 3600e3);
    const h = e.getHours();
    if (h >= 23 || h < 8) nightEmpty = e;
  }
  const emptyTime = nightEmpty?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  /* Батарея помпы на дне. Порог 5%, а не 20%: по истории замен видно, что шкала грубая
     и нелинейная (75 → 44 → 29 → 22 → 3 → 1), а НУЛЯ помпа не показывает вовсе — дно 1%.
     Тревожить раньше времени вредно: на 1% помпа реально работает ещё часы, поэтому
     формулировка — «поменяйте при случае», а не «срочно». Сколько именно осталось,
     сказать не можем, пока не знаем тип батарейки (см. бэклог). */
  const battery = dev?.pumpBattery ?? null;
  const batteryLow = battery != null && battery <= 5;

  // Локальные уведомления — только на переходе false→true (не спамим на каждый опрос).
  const suspendedRef = useRef(false);
  useEffect(() => {
    const now = dev?.suspended === true;
    if (now && !suspendedRef.current) notify('Помпа на паузе', 'Подача инсулина остановлена.');
    suspendedRef.current = now;
  }, [dev?.suspended]);

  const nightWarnedRef = useRef(false);
  useEffect(() => {
    const now = !!nightEmpty;
    if (now && !nightWarnedRef.current) {
      notify('Инсулин закончится ночью', `Осталось ≈${Math.round(hoursLeft as number)} ч (~${emptyTime}). Замените резервуар заранее.`);
    }
    nightWarnedRef.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!nightEmpty]);

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
              <div className="carb-macro"><span className="cm-k">У</span><span className="cm-v">{toCarbs(dayCarbs, cu)}</span><span className="cm-u">{carbUnitLabel(cu)}</span></div>
            </div>

            <div className="carb-center">
              <div className="carb-big">{cob != null ? toCarbs(cob, cu) : DASH}<span>{carbUnitLabel(cu)}</span></div>
              <div className="carb-lbl">активные углеводы</div>
              <div className="carb-sub">всего за день · {toCarbs(dayCarbs, cu)} {carbUnitLabel(cu)}</div>
            </div>

            <div className="carb-food">
              <IonIcon icon={restaurantOutline} />
              <div className="carb-food-t">Еда</div>
              <div className="carb-food-s">{mealCount} {mealsWord(mealCount)}</div>
            </div>
          </button>

          {/* помпа на паузе — важный статус, не прячем (авторитетно из AAPS) */}
          {dev?.suspended === true && (
            <div className="today-alert info">
              <IonIcon icon={pauseCircleOutline} />
              <div>
                <b>Помпа на паузе</b>
                <span>Подача инсулина остановлена.</span>
              </div>
            </div>
          )}

          {/* окончание резервуара придётся на ночь — поменять заранее */}
          {nightEmpty && (
            <div className="today-alert warn">
              <IonIcon icon={moonOutline} />
              <div>
                <b>Инсулина ≈{Math.round(hoursLeft as number)} ч — закончится ночью (~{emptyTime})</b>
                <span>Замените резервуар заранее, чтобы подача не прервалась во сне. Оценка по среднему расходу.</span>
              </div>
            </div>
          )}

          {/* батарея помпы на дне */}
          {batteryLow && (
            <div className="today-alert warn">
              <IonIcon icon={batteryDeadOutline} />
              <div>
                <b>Батарея помпы {battery}%</b>
                <span>Помпа не показывает ноль — {battery}% это уже дно шкалы. Поработает ещё, но батарейку стоит поменять при случае и носить запасную.</span>
              </div>
            </div>
          )}

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
