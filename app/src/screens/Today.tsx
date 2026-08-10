import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { AnalyticsSection } from '@/sections/lazy';
import { restaurantOutline, warningOutline, moonOutline, pauseCircleOutline, batteryDeadOutline, sparklesOutline, chevronForward } from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/sources/store';
import { useUnit, useCarbUnit, toCarbs, carbUnitLabel, toUnits, unitLabel, fmt } from '@/domain/units';
import { reportContentScroll } from '@/app/panel';
import { useDeviceExtras } from '@/sources/deviceExtras';
import { reservoirStats } from '@/domain/treatmentStats';
import { useCloseOnLeave } from '@/app/nav';
import { notify } from '@/platform/notify';
import FoodSheet from '@/sheets/FoodSheet';
import { DataGate } from '@/ui/NotConfigured';
import { useStack } from '@/app/stackCtx';
import { useAnalyticsOn } from '@/settings/analytics';

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
  const { push, pop } = useStack();
  const analyticsOn = useAnalyticsOn();

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

  /* Дневное окончание. Ночной случай выше строже (14 ч) — во сне человек не заметит.
     Но днём окончание тоже пропускается, если занят, а прерывание подачи одинаково
     плохо в любое время. Порог в ЧАСАХ, не в единицах: 10 ед при суточной дозе 20
     и при 60 — это принципиально разное время. Ночной баннер имеет приоритет,
     чтобы не показывать два про одно и то же. */
  const soonEmpty = hoursLeft != null && hoursLeft > 0 && hoursLeft < 6 && !nightEmpty;
  const emptyAt = soonEmpty
    ? new Date(Date.now() + (hoursLeft as number) * 3600e3).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : null;

  /* Батарея помпы на дне. Порог 5%, а не 20%: по истории замен видно, что шкала грубая
     и нелинейная (75 → 44 → 29 → 22 → 3 → 1), а НУЛЯ помпа не показывает вовсе — дно 1%.
     Тревожить раньше времени вредно: на 1% помпа реально работает ещё часы, поэтому
     формулировка — «поменяйте при случае», а не «срочно». Сколько именно осталось,
     сказать не можем, пока не знаем тип батарейки (см. бэклог). */
  const battery = dev?.pumpBattery ?? null;
  const batteryLow = battery != null && battery <= 5;

  /* Еда: либо человек давно не ел, либо поел и не внёс. Второе для нас важнее —
     незаписанная еда ломает расчёт активных углеводов, а значит и все подсказки.
     Косвенный признак: сахар заметно вырос, а углеводов в этом окне нет.

     Осторожно с ложными срабатываниями:
     • ночью не дёргаем — рост во сне это заря/гормоны, а не еда;
     • не считаем едой выход из гипо: подъём с 3,5 до 6 — это купирование низкого,
       и говорить «вы что-то съели» тут звучит глупо, хотя углеводы там тоже были;
     • нужен и рост, и текущий сахар выше цели — иначе поймаем обычные колебания. */
  const nowH = new Date().getHours();
  const daytime = nowH >= 8 && nowH < 23;
  const carbEvents = extras.events.filter((e) => (e.carbs ?? 0) > 0);
  const lastCarbT = carbEvents.length ? carbEvents[carbEvents.length - 1].t : null;
  const hoursSinceCarb = lastCarbT != null ? (Date.now() - lastCarbT) / 3600e3 : null;

  const es = data?.entries ?? [];
  const win = es.filter((e) => e.t >= Date.now() - 2 * 3600e3); // последние 2 ч
  const nowG = es.length ? es[es.length - 1].mmol : null;
  const minG = win.length ? Math.min(...win.map((e) => e.mmol)) : null;
  const rise = nowG != null && minG != null ? nowG - minG : null;

  /* Порог подобран на реальных данных, а не на глаз: при росте ≥2,5 баннер вылезал бы
     ~2,8 раза в сутки и превратился бы в фон. ≥4,0 ммоль/л за 2 ч при сахаре выше 10 —
     это уже размер настоящего приёма пищи, а не колебание. */
  const unloggedMeal = daytime && rise != null && rise >= 4 && (nowG as number) > 10
    && (hoursSinceCarb == null || hoursSinceCarb >= 2);
  // «давно не ел»: спокойный случай, без роста — просто напоминание
  const longNoFood = daytime && !unloggedMeal && hoursSinceCarb != null && hoursSinceCarb >= 7;


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

  // то же для дневного окончания: смысл предупреждения в том, что на экран не смотрят
  const soonWarnedRef = useRef(false);
  useEffect(() => {
    if (soonEmpty && !soonWarnedRef.current) {
      notify('Инсулин заканчивается', `Осталось ≈${Math.round(hoursLeft as number)} ч (~${emptyAt}). Пора менять резервуар.`);
    }
    soonWarnedRef.current = soonEmpty;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soonEmpty]);

  return (
    <IonPage>
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen">
          <DataGate>
          {/* Разбор — отдельный экран, а не врезка: «Сегодня» про то, что делать
              сейчас, разбор про то, что было. Выключённый показываем погасшим, а не
              прячем — иначе выключивший однажды уже не вспомнит, что это было. */}
          {analyticsOn ? (
            <button className="tile-an" onClick={() => push(<AnalyticsSection onClose={pop} />)}>
              <IonIcon icon={sparklesOutline} className="tile-an-ico" />
              <span className="tile-an-txt">
                <span className="tile-an-t">Аналитика</span>
                <span className="tile-an-s">разбор данных: расходники, сахар, пропуски</span>
              </span>
              <IonIcon icon={chevronForward} className="tile-an-chev" />
            </button>
          ) : (
            <div className="tile-an is-off">
              <IonIcon icon={sparklesOutline} className="tile-an-ico" />
              <span className="tile-an-txt">
                <span className="tile-an-t">Аналитика выключена</span>
                <span className="tile-an-s">включить: Профиль → Настройки → Выводить аналитику</span>
              </span>
            </div>
          )}

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

          {/* инсулин заканчивается днём — раньше про это не предупреждали вовсе */}
          {soonEmpty && (
            <div className="today-alert warn">
              <IonIcon icon={warningOutline} />
              <div>
                <b>Инсулина ≈{Math.round(hoursLeft as number)} ч — до ~{emptyAt}</b>
                <span>Резервуар скоро опустеет, подача прервётся. Оценка по среднему расходу.</span>
              </div>
            </div>
          )}

          {/* похоже, поел и не внёс — активные углеводы посчитаны неверно */}
          {unloggedMeal && (
            <div className="today-alert warn">
              <IonIcon icon={restaurantOutline} />
              <div>
                <b>Сахар вырос на {fmt(rise as number)} — еда записана?</b>
                <span>За 2 часа поднялся до {toUnits(nowG as number)} {unitLabel()}, а углеводов не внесено. Если поели — добавьте, иначе активные углеводы и подсказки будут врать.</span>
              </div>
            </div>
          )}

          {/* давно не было еды — спокойное напоминание, без роста сахара */}
          {longNoFood && (
            <div className="today-alert info">
              <IonIcon icon={restaurantOutline} />
              <div>
                <b>Еды не вносили {Math.round(hoursSinceCarb as number)} ч</b>
                <span>Либо давно не ели, либо забыли записать. Внесённая еда нужна для расчёта активных углеводов.</span>
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
          </DataGate>
        </div>
        <FoodSheet isOpen={foodOpen} onClose={() => setFoodOpen(false)} />
      </IonContent>
    </IonPage>
  );
}
