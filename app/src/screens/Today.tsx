import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { AnalyticsSection, MealsSection } from '@/sections/lazy';
import { restaurantOutline, warningOutline, waterOutline, moonOutline, pauseCircleOutline, batteryDeadOutline, sparklesOutline, chevronForward } from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/sources/store';
import { useUnit, useCarbUnit, toCarbs, carbUnitLabel, toUnits, unitLabel, fmt, agoText } from '@/domain/units';
import { reportContentScroll } from '@/app/panel';
import { activeCarbs } from '@/domain/loopValue';
import ChangedButton from '@/ui/ChangedButton';
import ReleaseBle from '@/ui/ReleaseBle';
import NearbyTile from '@/ui/NearbyTile';
import ConnectFeed from '@/ui/ConnectFeed';
import UpdateReady from '@/ui/UpdateReady';
import SnoozeBtn from '@/ui/SnoozeBtn';
import { useОтложения, показывать, прибрать } from '@/settings/snooze';
import { useChanges, markChanged, askedRefill, markRefillAsked } from '@/settings/changes';
import { useDeviceConfig } from '@/settings/deviceConfig';
import { useDeviceExtras } from '@/sources/deviceExtras';
import { reservoirStats } from '@/domain/treatmentStats';
import { batteryRuntime, BATTERY_KINDS } from '@/domain/battery';
import { detectRefill } from '@/domain/refill';
import { onlyLocal } from '@/domain/meals';
import { часыБодрствования } from '@/domain/awake';
import { useMeals } from '@/sources/mealStore';
import type { Plateau } from '@/domain/plateau';
import { getSeries, onDbChange } from '@/sources/db';
import { useCloseOnLeave } from '@/app/nav';
import { notify } from '@/platform/notify';
import FoodSheet from '@/sheets/FoodSheet';
import { DataGate } from '@/ui/NotConfigured';
import { useStack } from '@/app/stackCtx';
import { useAnalyticsOn } from '@/settings/analytics';
import { useAnalysis, непрочитанныеВажные } from '@/domain/useAnalysis';
import { useSeenInsights } from '@/settings/seenInsights';

const DASH = '—';

const isPaused = (s?: string | null) => {
  const l = (s || '').toLowerCase();
  return l.includes('приостан') || l.includes('пауза') || l.includes('suspend') || l.includes('stop');
};

const часы = (h: number) => (h < 24 ? Math.round(h) + ' ч' : Math.round(h / 24 * 10) / 10 + ' сут');
const замен = (n: number) => (n === 1 ? 'замене' : 'заменам');

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
  const cfg = useDeviceConfig();
  const changes = useChanges();
  const meals = useMeals();
  const rstat = reservoirStats(extras.devHist);
  /* История заряда копится в своей базе: в облаке за один запрос доступны последние
     часы, а один цикл разряда занимает недели (sources/db.ts, putBatteryPoints). */
  const [bhist, setBhist] = useState<Plateau[]>([]);
  const [rhist, setRhist] = useState<Plateau[]>([]);
  useEffect(() => {
    let жив = true;
    const читать = () => {
      void getSeries('battery').then((x) => { if (жив) setBhist(x); });
      void getSeries('reservoir').then((x) => { if (жив) setRhist(x); });
    };
    читать();
    const off = onDbChange(читать);
    return () => { жив = false; off(); };
  }, []);

  /* Заправка картриджа: переход «почти пусто → почти полный». Признак чистый (см.
     domain/refill.ts), но отмечаем не молча, а спрашиваем — молчаливая отметка по
     эвристике ошибается незаметно, а вопрос ошибается дёшево. */
  const заправка = detectRefill(rhist);
  const спроситьЗаправку = заправка != null
    && заправка.at > askedRefill()
    && заправка.at > (changes.reservoir ?? 0);
  const bstat = batteryRuntime(bhist.map((x) => ({ t: x.t, reservoir: null, pumpBattery: x.v, uploaderBattery: null })));
  /* Тип батарейки объясняет, почему у соседа те же 20% значат другое. Не задан —
     молчим: догадываться о химии по цифрам мы не умеем. */
  const kind = BATTERY_KINDS.find((b) => b.id === cfg.pumpBatteryKind) ?? null;
  const kindNote = kind ? `Батарейка ${kind.name.toLowerCase()}: ${kind.note}.` : null;

  // углеводы за сегодня (с локальной полуночи)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todayCarbs = extras.events.filter((e) => (e.carbs ?? 0) > 0 && e.t >= dayStart.getTime());
  /* Свои записи считаем вместе с облачными, но без задвоения: когда выгрузка появится,
     наш же приём вернётся из Nightscout, и без склейки он посчитался бы дважды —
     а задвоенные углеводы это задвоенная доза (domain/meals.ts). */
  const свои = onlyLocal(meals, extras.events).filter((m) => m.t >= dayStart.getTime());
  const dayCarbs = Math.round(
    todayCarbs.reduce((a, b) => a + (b.carbs || 0), 0) + свои.reduce((a, b) => a + b.carbs, 0),
  );
  /* Счётчик приёмов — за СУТКИ, а не с полуночи. В час ночи «0 приёмов» формально
     верно и совершенно бесполезно: человек ужинал четыре часа назад. А рядом эта же
     колонка ведёт в журнал, где эти приёмы видны, — и «0» рядом с четырьмя записями
     читается как поломка.

     Сумма в граммах остаётся дневной: она подписана «всего за день», и по дням же
     считается весь разбор. Разные окна тут не противоречие, а разные вопросы:
     «сколько я съел сегодня» и «когда я ел в последний раз». */
  const сутки = Date.now() - 24 * 3600e3;
  const свежие = [
    ...extras.events.filter((e) => (e.carbs ?? 0) > 0 && e.t >= сутки).map((e) => ({ t: e.t, carbs: e.carbs as number })),
    ...onlyLocal(meals, extras.events).filter((m) => m.t >= сутки).map((m) => ({ t: m.t, carbs: m.carbs })),
  ].sort((a, b) => a.t - b.t);
  const mealCount = свежие.length;
  /* Последний приём — из обоих источников. Отвечает на «я записал?»: с одного взгляда
     видно и сколько, и как давно, и не надо идти в журнал проверять. */
  const последний = свежие.length ? свежие[свежие.length - 1] : null;
  /* Активные углеводы тоже считает цикл, а не помпа: когда он молчит, это
     «неизвестно», а не «ноль». Прочерк плюс причина — см. domain/loopValue.ts. */
  const ac = activeCarbs(dev);
  const cob = ac.known ? Math.round(dev!.cob as number) : null;

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
  /* «Еды не вносили N ч» и «похоже, поел без записи» должны замолкать от НАШЕЙ записи
     тоже — иначе человек внесёт приём в приложении, а мы продолжим ему выговаривать,
     что он ничего не внёс. */
  const lastCarbT = Math.max(
    carbEvents.length ? carbEvents[carbEvents.length - 1].t : 0,
    meals.length ? meals[meals.length - 1].t : 0,
  ) || null;
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
  /* Считаем часы, когда человек МОГ поесть, а не календарные. Иначе в восемь утра
     подсветка объявляет восемь часов молчания — а человек спал, и это норма. Приложение,
     которое регулярно говорит очевидную ерунду, перестают читать вообще, и настоящее
     предупреждение проходит мимо вместе с ней (domain/awake.ts). */
  const бодрыхЧасов = lastCarbT != null ? часыБодрствования(lastCarbT, Date.now()) : null;
  const longNoFood = daytime && !unloggedMeal && бодрыхЧасов != null && бодрыхЧасов >= 7;


  /* Счётчик важного на плитке разбора (#148). Считаем НЕПРОЧИТАННОЕ: постоянное
     число через неделю означает ноль — человек перестаёт его видеть, и когда там
     появится настоящая беда, он не отличит её от привычной цифры.

     Расчёт общий с самим разбором и попадает в те же кэши — второго чтения базы и
     второго счёта не происходит (domain/useAnalysis.ts). */
  const { analysis } = useAnalysis(14);
  const виденные = useSeenInsights();
  const новых = analyticsOn ? непрочитанныеВажные(analysis, виденные) : 0;
  /* Красный — только когда среди непрочитанного есть bad. «Данных мало для разбора» и
     «половина показаний не доехала» не одного веса, и одинаковый красный кружок
     уравнял бы их. */
  const срочное = analysis.insights.some(
    (i) => i.severity === 'bad' && !виденные.includes(i.id),
  );

  /* Отложенные подсветки (#147). Эпизод отвечает «какой это случай», уровень —
     «насколько плохо внутри случая». Отложили — молчим до смены эпизода или до
     ухудшения на шаг; правило и его обоснование в domain/snooze.ts.

     Эпизоды выбраны так, чтобы их смена означала «это уже другой случай»:
     • батарея и резервуар — по отметке замены: поменял, значит начался новый цикл;
     • застой резервуара — по часу начала застоя;
     • подъём сахара — по самому подъёму: другой подъём это другой вопрос;
     • «давно не ели» — по времени последнего приёма.

     Уровни растут в сторону «хуже»: у батареи это 100 минус процент, у резервуара —
     минус часы до конца. Шаги подобраны так, чтобы возврат означал заметное
     изменение, а не дрожание шкалы. */
  const отложения = useОтложения();
  const эпБатарея = String(changes.battery ?? 0);
  const эпРезервуар = String(changes.reservoir ?? 0);
  const эпЗастой = String(Math.round((Date.now() - rstat.flatHours * 3600e3) / 3600e3));
  const эпПодъём = String(Math.round((lastCarbT ?? 0) / 60000)) + ':' + Math.round(rise ?? 0);
  const эпБезЕды = String(lastCarbT ?? 0);

  const виднаБатарея = batteryLow
    && показывать(отложения, 'battery', эпБатарея, 100 - (battery as number), 1);
  const виденРезервуар = показывать(отложения, 'reservoir', эпРезервуар, Math.round(-(hoursLeft ?? 0)), 2);
  const виденЗастой = stuck && показывать(отложения, 'stuck', эпЗастой, Math.round(rstat.flatHours), 6);
  const виденПодъём = unloggedMeal && показывать(отложения, 'rise', эпПодъём, Math.round(rise ?? 0), 3);
  const виднаЕда = longNoFood && показывать(отложения, 'nofood', эпБезЕды, Math.round(бодрыхЧасов ?? 0), 4);

  /* Отложения с уже сменившимся эпизодом ни на что не влияют — выбрасываем при
     заходе, чтобы список не рос вечно. Отдельной уборки по расписанию не нужно. */
  useEffect(() => {
    прибрать({ battery: эпБатарея, reservoir: эпРезервуар, stuck: эпЗастой, nofood: эпБезЕды });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [эпБатарея, эпРезервуар, эпЗастой, эпБезЕды]);

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
      <IonContent fullscreen forceOverscroll scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen">
          <DataGate>
          {/* Панель углеводов: сейчас — сверху, записанное — снизу.

              Три колонки (Б/Ж/У · активные · Еда) распались, как только из левой ушли
              белки и жиры: три блока с разным выравниванием и размером висели рядом
              без единой связи, и было непонятно, что к чему относится.

              Связь есть, и она временная: наверху то, что действует сейчас и меняет
              решение, внизу — что уже записано и где это посмотреть. Черта между
              строками показывает эту границу; она же делит и нажатия — верх вносит,
              низ открывает журнал.

              Число и подпись встали в строку, а не стопкой: «0 г активные углеводы»
              читается как фраза слева направо, а центрированная стопка посреди плитки
              не принадлежала ни одному краю. */}
          {/* Углеводы и аналитика — в одну строку (#148). Аналитика занимала целую
              строку ради двух слов, а ниже идут подсветки: чем раньше они попадают в
              поле зрения, тем выше шанс, что их прочитают, а не пролистают.

              Углеводам три четверти, аналитике четверть: в плитке углеводов живут два
              числа и действие, а у входа в разбор задача одна — быть заметным и
              сказать, есть ли там что-то новое. */}
          <div className="today-row">
          <div className="carb-panel">
            <button className="carb-now" onClick={() => setFoodOpen(true)}>
              <div className={'carb-big' + (ac.known ? '' : ' is-unknown')}>{cob != null ? toCarbs(cob, cu) : DASH}<span>{carbUnitLabel(cu)}</span></div>
              <div className="carb-now-t">
                <div className="carb-lbl">активные углеводы</div>
                {ac.reason && <div className="carb-sub">{ac.reason}</div>}
              </div>
              {/* Действие названо глаголом. «Еда» была существительным: что случится по
                  нажатию — открытие журнала или ввод — приходилось угадывать. */}
              <span className="carb-add">
                <IonIcon icon={restaurantOutline} />
                <span>внести</span>
              </span>
            </button>

            {/* Нижняя строка отвечает на «я это вообще записал?» — вопрос, который
                человек задаёт себе чаще всего. Раньше проверить было негде: просить
                точное время и не показывать результат — нечестно. */}
            <button className="carb-hist"
              onClick={() => push(<MealsSection onClose={pop} />)}>
              {/* Коротко, потому что плитка отдала четверть ширины разбору (#148).
                  «5 ч» вместо «5 ч назад» и цифра вместо «3 приёма»: длинная форма
                  обрезалась многоточием — и обрезалось на ней как раз число, то
                  единственное, ради чего строку читают. */}
              <span className="carb-hist-l">
                {последний
                  ? <>Последний <b>{toCarbs(последний.carbs, cu)} {carbUnitLabel(cu)}</b> · {agoText(последний.t).replace(' назад', '')}</>
                  : 'За сутки не вносили'}
              </span>
              <span className="carb-hist-r">
                {mealCount > 0 && <>{mealCount} · {toCarbs(dayCarbs, cu)} {carbUnitLabel(cu)}</>}
                {mealCount === 0 && 'журнал'}
                <IonIcon icon={chevronForward} />
              </span>
            </button>
          </div>


          {/* Разбор — отдельный экран, а не врезка: «Сегодня» про то, что делать
              сейчас, разбор про то, что было. В том же виде, что панель углеводов:
              обе — крупные входы, стоящие рядом, и разнобой в оформлении читался бы
              как разная важность. Выключенный показываем погасшим, а не прячем —
              иначе выключивший однажды уже не вспомнит, что это было. */}
          {analyticsOn && (
            <button className="an-tile" onClick={() => push(<AnalyticsSection onClose={pop} />)}>
              <IonIcon icon={sparklesOutline} />
              <span className="an-tile-t">Разбор</span>
              {/* Значка нет, когда важного нет: пустой счётчик приучает на счётчик не
                  смотреть. Число — только про непрочитанное, иначе постоянная «12»
                  через неделю не означает ничего (domain/useAnalysis.ts). */}
              {новых > 0 && (
                <span className={'an-badge' + (срочное ? ' is-bad' : '')}>{новых}</span>
              )}
            </button>
          )}
          </div>

          {/* Выключенный разбор — строкой под рядом, а не плиткой в нём: место в ряду
              стоит дорого, а сообщение «вы это выключили» не стоит ничего. Но и
              спрятать нельзя — выключивший однажды не вспомнит, что это было. */}
          {!analyticsOn && (
            <div className="an-off-note">Разбор данных выключен · Профиль → Настройки</div>
          )}

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
          {nightEmpty && виденРезервуар && (
            <div className="today-alert warn">
              <IonIcon icon={moonOutline} />
              <div>
                <b>Инсулина ≈{Math.round(hoursLeft as number)} ч — закончится ночью (~{emptyTime})</b>
                <span>Замените резервуар заранее, чтобы подача не прервалась во сне. Оценка по среднему расходу.</span>
                <SnoozeBtn ключ="reservoir" эпизод={эпРезервуар} уровень={Math.round(-(hoursLeft ?? 0))} />
              </div>
            </div>
          )}

          {/* инсулин заканчивается днём — раньше про это не предупреждали вовсе */}
          {soonEmpty && виденРезервуар && (
            <div className="today-alert warn">
              <IonIcon icon={warningOutline} />
              <div>
                <b>Инсулина ≈{Math.round(hoursLeft as number)} ч — до ~{emptyAt}</b>
                <span>Резервуар скоро опустеет, подача прервётся. Оценка по среднему расходу.</span>
                <SnoozeBtn ключ="reservoir" эпизод={эпРезервуар} уровень={Math.round(-(hoursLeft ?? 0))} />
              </div>
            </div>
          )}

          {/* похоже, поел и не внёс — активные углеводы посчитаны неверно */}
          {виденПодъём && (
            <div className="today-alert warn">
              <IonIcon icon={restaurantOutline} />
              <div>
                <b>Сахар вырос на {fmt(rise as number)} — еда записана?</b>
                <span>За 2 часа поднялся до {toUnits(nowG as number)} {unitLabel()}, а углеводов не внесено. Если поели — добавьте, иначе активные углеводы и подсказки будут врать.</span>
                <SnoozeBtn ключ="rise" эпизод={эпПодъём} уровень={Math.round(rise ?? 0)} />
              </div>
            </div>
          )}

          {/* давно не было еды — спокойное напоминание, без роста сахара */}
          {виднаЕда && (
            <div className="today-alert info">
              <IonIcon icon={restaurantOutline} />
              <div>
                <b>Еды не вносили {Math.round(бодрыхЧасов as number)} ч</b>
                <span>Либо давно не ели, либо забыли записать. Внесённая еда нужна для расчёта активных углеводов.</span>
                <SnoozeBtn ключ="nofood" эпизод={эпБезЕды} уровень={Math.round(бодрыхЧасов ?? 0)} />
              </div>
            </div>
          )}

          {/* Батарея на дне. Главное здесь — не пугать процентом: помпа не показывает
              ноль вовсе, и «1%» означает не «выключится сейчас». Сколько именно
              осталось, знает только собственная история человека, поэтому если циклов
              мы ещё не видели — так и говорим, а не подставляем чужую цифру. */}
          {виднаБатарея && (
            <div className="today-alert warn">
              <IonIcon icon={batteryDeadOutline} />
              <div>
                <b>Батарея помпы {battery}%</b>
                <span>
                  {bstat.floorPct != null
                    ? `Помпа не показывает ноль: ниже ${bstat.floorPct}% она не опускается. `
                    : 'Помпа не показывает ноль, поэтому процент занижает запас. '}
                  {bstat.medianHours != null
                    ? `После ${bstat.floorPct}% в прошлые разы протягивала ${часы(bstat.medianHours)} — медиана по ${bstat.cycles} ${замен(bstat.cycles)}.`
                    : 'Сколько ещё протянет, пока сказать не можем: замен с полной историей не набралось. Носи запасную.'}
                  {kindNote && ` ${kindNote}`}

                </span>
                <span className="alert-ask">
                  Поставил новую?
                  <ChangedButton what="battery" label="Поменял батарейку" />
                  <SnoozeBtn ключ="battery" эпизод={эпБатарея} уровень={100 - (battery as number)} />
                </span>
              </div>
            </div>
          )}

          {/* Вопрос о заправке. Идёт выше прочих подсветок: остальные сообщают, а этот
              просит подтвердить — и пока не подтвердили, возраст резервуара неверен. */}
          {спроситьЗаправку && заправка && (
            <div className="today-alert">
              <IonIcon icon={waterOutline} />
              <div>
                <b>Похоже, ты заправил картридж</b>
                <span>
                  Остаток поднялся с {Math.round(заправка.from)} до {Math.round(заправка.to)} ед {agoText(заправка.at)}.
                  В Nightscout события об этом нет, поэтому спрашиваем.
                </span>
                {/* Один вопрос, три ответа, а не два вопроса подряд.

                    Сначала я спрашивал отдельно про картридж и отдельно про набор —
                    формально честно (скачок остатка говорит только про картридж), а на
                    деле человек отвечал дважды про одно решение. В жизни картридж и
                    набор чаще меняют вместе: помпа сама ведёт через перемотку, замену и
                    заполнение. Значит «оба» — обычный случай, а «только картридж» —
                    отдельный, и это выбор, а не два допроса. */}
                <span className="alert-ask alert-ask-row">
                  <button className="changed-btn is-undo"
                    onClick={() => { markChanged('reservoir', заправка.at); markChanged('site', заправка.at); markRefillAsked(заправка.at); }}>
                    Картридж и набор
                  </button>
                  <button className="changed-btn"
                    onClick={() => { markChanged('reservoir', заправка.at); markRefillAsked(заправка.at); }}>
                    Только картридж
                  </button>
                  <button className="changed-btn" onClick={() => markRefillAsked(заправка.at)}>Нет</button>
                </span>
              </div>
            </div>
          )}

          {/* Лента подключения: «сейчас поднимается вот что». Живёт минуты, потом
              исчезает сама — подключение это событие, а не состояние (ui/ConnectFeed). */}
          <ConnectFeed />

          {/* Вход в поиск по эфиру. Заметен, только когда подключать нечего или связь
              отвалилась; когда всё работает — тихая строка (ui/NearbyTile.tsx). */}
          <NearbyTile />

          {/* Обновление скачано и ждёт перезапуска. Ниже связи и выше подсветок
              резервуара намеренно: это не медицинское событие и не должно попадаться
              раньше них, но и в настройках его никто не найдёт — а не найдя, человек
              останется на старой сборке навсегда (ui/UpdateReady.tsx, #150). */}
          <UpdateReady />

          {/* Отдать устройства. Рядом с подсветками, а не в настройках: это действие
              нужно в моменте — «дай отсканировать сенсор родным приложением», — и
              искать его по разделам человек не будет. Само появляется, только когда
              есть что отпускать. */}
          <ReleaseBle />

          {/* подсветки резервуара */}
          {виденЗастой && (
            <div className="today-alert warn">
              <IonIcon icon={warningOutline} />
              <div>
                <b>Резервуар не меняется {Math.round(rstat.flatHours)} ч</b>
                <span>А помпа не на паузе — инсулин должен расходоваться. Проверь подачу (окклюзия, катетер, датчик резервуара).</span>
                {/* Проактивный вопрос вместо ретроактивной правки: у этого залипания
                    есть вторая, гораздо более частая причина — картридж поменяли, а
                    помпа этого не показала. Спросить дешевле, чем заставлять человека
                    искать, где это исправить. */}
                <span className="alert-ask">
                  Или ты уже поменял, а помпа не заметила?
                  <ChangedButton what="reservoir" label="Поменял резервуар" />
                  <SnoozeBtn ключ="stuck" эпизод={эпЗастой} уровень={Math.round(rstat.flatHours)} />
                </span>
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
