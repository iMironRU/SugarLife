import { IonApp, createGesture } from '@ionic/react';
import { следитьЗаВозвратом } from '@/app/возврат';
import Иконка from '@/ui/Иконка';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { barChart, pulse, home, water, settingsOutline, medkit } from 'ionicons/icons';

import Today from '@/screens/Today';
import Profile from '@/screens/Profile';
import Metrics from '@/screens/Metrics';
import Mon from '@/screens/Mon';
import Ins from '@/screens/Ins';
/* Мастер первого запуска — отдельным куском: он нужен, пока ничего не подключено,
   а тянет за собой справочник помп, сенсоров и инсулинов (132 КБ). Держать это в
   первом куске значит заставлять каждый запуск ждать данные, которые понадобятся
   один раз в жизни. */
const Onboarding = lazy(() => import('@/screens/Onboarding'));
import Loader from '@/screens/Loader';
import ПервыйСнимок from '@/ui/ПервыйСнимок';
import { isNative } from '@/platform/appUpdate';
import InstallPrompt from '@/ui/InstallPrompt';
import HeroPanel from '@/app/HeroPanel';
import { useStore } from '@/sources/store';
import { досылНеотправленных } from '@/sources/mealStore';
import { отдатьОкноСна } from '@/settings/health';
import { отдатьЕдиницыДвижку } from '@/domain/units';
import { следитьЗаИнсулином } from '@/settings/инсулинДвижку';
import { отдатьСонДвижку } from '@/platform/сонИзЗдоровья';
import { useСейчас } from '@/показ/сейчас';
import { сообщитьИнсулин } from '@/platform/живойБаннер';
import { useSnapshot } from '@/sources/bridge';
import { useAnalysis, непрочитанныеВажные } from '@/domain/useAnalysis';
import { useSeenInsights } from '@/settings/seenInsights';
import { diffBleActivity } from '@/sources/bleActivity';
import { checkBridgeBattery } from '@/settings/bridgeAlerts';
import { detectTherapy } from '@/domain/therapy';
import { useTab, setTab, pressTab, getTab, TAB_PATHS } from '@/app/nav';
import ПереходПоЦели from '@/app/ПереходПоЦели';
import { useOnboarded } from '@/settings/onboarding';
import { StackHost } from '@/app/stack';
import { requestNotifyPermissionOnStart } from '@/platform/notify';
import { startHistorySync } from '@/sources/historySync';
import { копитьРядыПриборов } from '@/sources/рядыПриборов';
import { прогретьРазделы } from '@/sections/lazy';
import { прогретьГрафик } from '@/charts/warm';

// Порядок вкладок: 0 Метрики · 1 НМГ · 2 Сегодня · 3 Инсулин · 4 Профиль
function Pager() {
  const idx = useTab();
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  /* ВЕРНУЛСЯ ИЗ ФОНА ЧЕРЕЗ ЧЕТВЕРТЬ ЧАСА — ОТКРЫВАЕМ «СЕГОДНЯ» (#703, app/возврат.ts).

     Правило «где человек был» работало только при перезапуске приложения, а сворачивают его
     намного чаще, чем оно перезапускается: правило было написано для редкого случая и не
     работало в частом. */
  useEffect(() => следитьЗаВозвратом(), []);

  // применить позицию при смене вкладки (кнопки таб-бара / крылья панели) — плавно
  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    t.style.transition = 'transform .3s cubic-bezier(.3,.9,.3,1)';
    t.style.transform = `translate3d(${-idx * 100}%,0,0)`;
  }, [idx]);

  // горизонтальный жест: трек едет за пальцем, на отпускании — доводка к вкладке
  useEffect(() => {
    const vp = viewportRef.current;
    const t = trackRef.current;
    if (!vp || !t) return;
    const N = TAB_PATHS.length;
    let W = vp.clientWidth;
    let base = 0;

    const setX = (px: number) => { t.style.transform = `translate3d(${px}px,0,0)`; };
    // позиция ПОКОЯ — в процентах (независимо от ширины: -idx*100% всегда точно
    // по вкладке, даже если ширина вьюпорта менялась — адресная строка, поворот)
    const rest = (i: number) => { t.style.transform = `translate3d(${-i * 100}%,0,0)`; };

    const gesture = createGesture({
      el: vp,
      gestureName: 'tab-pager',
      direction: 'x',
      threshold: 8,
      /* Внутри открытого раздела горизонтальный жест значит «назад», а не «другая
         вкладка». Иначе два жеста спорят за одно движение, и побеждает то один, то
         другой — ровно та рваность, которую мы уже вычищали из панели. */
      canStart: () => !document.querySelector('.pager-pane.is-active .stack-page'),
      onStart: () => {
        W = vp.clientWidth;
        base = -getTab() * W;
        t.style.transition = 'none';
      },
      onMove: (d) => {
        let dx = d.deltaX;
        const cur = getTab();
        // резинка на краях
        if ((cur === 0 && dx > 0) || (cur === N - 1 && dx < 0)) dx *= 0.35;
        setX(base + dx);
      },
      onEnd: (d) => {
        const cur = getTab();
        const far = Math.abs(d.deltaX) > W * 0.25;
        const fast = Math.abs(d.velocityX) > 0.3;
        let target = cur;
        if ((far || fast) && Math.abs(d.deltaX) > Math.abs(d.deltaY)) {
          target = d.deltaX < 0 ? Math.min(N - 1, cur + 1) : Math.max(0, cur - 1);
        }
        t.style.transition = 'transform .3s cubic-bezier(.3,.9,.3,1)';
        rest(target);
        setTab(target); // если target === cur — эффект не сработает, позиция уже выставлена
      },
    });
    gesture.enable();
    const onResize = () => { t.style.transition = 'none'; rest(getTab()); };
    window.addEventListener('resize', onResize);
    return () => { gesture.destroy(); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div className="pager-viewport" ref={viewportRef}>
      <div className="pager-track" ref={trackRef} style={{ transform: `translate3d(${-idx * 100}%,0,0)` }}>
        <div data-tab={0} className={'pager-pane' + (idx === 0 ? ' is-active' : '')}><StackHost tab={0}><Metrics /></StackHost></div>
        <div data-tab={1} className={'pager-pane' + (idx === 1 ? ' is-active' : '')}><StackHost tab={1}><Mon /></StackHost></div>
        {/* Переход по цели живёт внутри стека «Сегодня» (#524): ему нужен `push`, а раздел он
            кладёт поверх — чтобы «назад» вернуло человека туда, где он был. */}
        <div data-tab={2} className={'pager-pane' + (idx === 2 ? ' is-active' : '')}><StackHost tab={2}><ПереходПоЦели /><Today /></StackHost></div>
        <div data-tab={3} className={'pager-pane' + (idx === 3 ? ' is-active' : '')}><StackHost tab={3}><Ins /></StackHost></div>
        <div data-tab={4} className={'pager-pane' + (idx === 4 ? ' is-active' : '')}><StackHost tab={4}><Profile /></StackHost></div>
      </div>
    </div>
  );
}

/* Счётчик непрочитанного важного переехал сюда с плитки «Разбор» (#255).

   Плитку с «Сегодня» убрали, и вместе с ней исчез бы единственный признак того, что в
   разборе появилось что-то новое. Молча потерять сигнал хуже, чем оставить плитку:
   человек не знает, что не знает.

   Считаем НЕПРОЧИТАННОЕ, а не всё важное: постоянная цифра через неделю означает ноль —
   на неё перестают смотреть, и настоящую беду не отличат от привычного числа. */
function TabBar({ insIcon, новых }: { insIcon: string; новых: number }) {
  const idx = useTab();
  const tabs = [
    { i: 0, label: 'Метрики', icon: barChart, badge: новых },
    { i: 1, label: 'НМГ', icon: pulse },
    { i: 2, label: 'Сегодня', icon: home },
    { i: 3, label: 'Инсулин', icon: insIcon },
    /* «НАСТРОЙКИ», А НЕ «ПРОФИЛЬ» (решение владельца).

       Профиля там нет и не было: ни имени, ни медицинской карточки, ни переключателя между людьми —
       всё это убрали ещё в #212, потому что имя приезжало из Nightscout, а без него в аватаре
       стояло слово «Профиль». Осталось то, что и так там лежало: приборы, единицы, охрана,
       диагностика, оформление. Это настройки, и называть их надо своим именем.

       Мульти-профили появятся — станут отдельным входом ВНУТРИ настроек, а не именем вкладки:
       переключатель между людьми это не то же самое, что «где всё настраивается». */
    { i: 4, label: 'Настройки', icon: settingsOutline },
  ];
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <button key={t.i} className={'tab' + (idx === t.i ? ' on' : '')} onClick={() => pressTab(t.i)}>
          <Иконка icon={t.icon} />
          {!!t.badge && <span className="tab-badge">{t.badge}</span>}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { data, status } = useStore();
  const snap = useSnapshot();
  const onboarded = useOnboarded();
  const мастерОткрыт = useRef(false);
  const insIcon = detectTherapy(data) === 'pen' ? medkit : water;

  /* АКТИВНЫЙ ИНСУЛИН — НАТИВУ (#500). Сводка в шторке живёт в фоне, где webview спит, а в облачном
     режиме инсулин считает Nightscout, а не движок. Отдаём число, пока приложение открыто; в нативе
     оно хранится со сроком годности, так что устаревшее в шторку не попадёт.

     Здесь, а не в панели: панель — про показ, а это передача данных наружу приложения. */
  /* ЧИСЛО БЕРЁМ ТАМ ЖЕ, ГДЕ ЭКРАН (#528). Иначе в шторке и на «Сегодня» оказывались бы разные
     инсулины: одно от движка, другое от нашей загрузки Nightscout. */
  /* ЧЕРЕЗ МОДЕЛЬ ЭКРАНА, А НЕ СВОИМ РАСЧЁТОМ (показ/сейчас.ts).

     Здесь стоял чужой `iob` напрямую — и это уезжало в баннер, виджет и сводку, пока кружок на
     «Сегодня» показывал другое число. Правило «берём там же, где экран» было написано строкой выше
     ещё в #528, и код всё равно разошёлся: написанное правило ничего не стережёт. */
  const { инсулин } = useСейчас();
  useEffect(() => {
    void сообщитьИнсулин(инсулин.известен ? инсулин.значение : null);
  }, [инсулин.известен, инсулин.значение]);

  // Спрашиваем разрешение на уведомления сразу при старте (не ждём первого
  // реального события) — так пользователь явно видит и решает.
  useEffect(() => { requestNotifyPermissionOnStart(); }, []);

  /* ДОСЫЛ ЕДЫ (#657). Первая попытка отправки бывает в лифте, в самолёте и до того, как поднялся
     движок. Без досыла такая запись осталась бы местной навсегда, а человек считал бы, что
     углеводы ушли: он их внёс и увидел на экране. */
  useEffect(() => { void досылНеотправленных(); }, []);

  /* И ЕЩЁ РАЗ — КОГДА ПОЯВИЛСЯ ЭФИР.
     Досыл при монтировании ловит тёплый движок, но холодный старт он как раз пропускает: движок
     поднимается позже нас, отправлять некуда, и следующая попытка была бы только при СЛЕДУЮЩЕМ
     запуске приложения — то есть, может быть, через сутки. Первый снимок означает, что мост жив;
     на нём и досылаем. Повтор безопасен: досыл берёт только неотправленное, а ключ у записи наш и
     постоянный. */
  const досылалиПоЭфиру = useRef(false);
  useEffect(() => {
    if (!snap || досылалиПоЭфиру.current) return;
    досылалиПоЭфиру.current = true;
    void досылНеотправленных();
  }, [snap]);

  /* ОКНО СНА — ДВИЖКУ ПРИ СТАРТЕ (#597).

     Настройка «Обычно ложусь / встаю» могла быть задана давно, а движок про неё не знает: до
     сегодня мы её никуда не слали. Без досыла он узнал бы окно только когда человек полезет
     править настройку заново — то есть, возможно, никогда. */
  useEffect(() => { отдатьОкноСна(); }, []);

  /* Единицы глюкозы — движку при старте (#674). Числа форматирует он, переключатель наш: не
     сказав, мы получили бы на одном экране обе системы. */
  useEffect(() => { отдатьЕдиницыДвижку(); }, []);

  /* И выбранный инсулин — туда же (#674). Он лежал только у нас, а движок считал активный
     инсулин по умолчаниям: пик 75 мин, длительность 5 ч. У быстрых инсулинов кривые разные, и
     человек, выбравший свой, получал расчёт по чужому. */
  useEffect(() => следитьЗаИнсулином(), []);

  /* СОН ИЗ ЗДОРОВЬЯ — ДВИЖКУ (#597, ядро #177).

     При запуске и при возвращении на экран, а НЕ по таймеру: ядро сказало прямо — сессии приезжают
     задним числом, раз в несколько часов. Опрос по расписанию будил бы приложение зря, а живучесть
     у нас и без того больное место: за сутки нас выгружало двадцать пять раз.

     Возвращение на экран — честный признак «человек здесь»: если он проснулся и открыл приложение,
     ночная сессия у часов уже, скорее всего, досчитана. */
  useEffect(() => {
    void отдатьСонДвижку();
    const наЭкране = () => { if (document.visibilityState === 'visible') void отдатьСонДвижку(); };
    document.addEventListener('visibilitychange', наЭкране);
    return () => document.removeEventListener('visibilitychange', наЭкране);
  }, []);

  /* Прогрев кусков разделов и графика — в простое, после первого экрана.

     Раздел, код которого ещё не приехал, открывается в два шага: сначала выезжает
     пустая страница, потом в ней появляется содержимое. Экономии от этого никакой —
     кусок всё равно скачается, только в самый неудобный момент, под нажатием.

     Секунда задержки — чтобы не спорить за канал с первой загрузкой показаний: они
     важнее любого раздела. Дальше очередь идёт по одному куску в простое. */
  useEffect(() => {
    const id = window.setTimeout(() => { прогретьРазделы(); void прогретьГрафик(); }, 1000);
    return () => window.clearTimeout(id);
  }, []);

  /* История НМГ у ядра единая (сенсор + Nightscout + облака), а у нас до сих пор
     наполнялась только из Nightscout. Подписываемся на мост и тянем недостающее —
     иначе показания сенсора, прочитанного напрямую, в историю не попадут вовсе
     (sources/historySync.ts, SugarLifeCore#6). */
  useEffect(() => startHistorySync(), []);

  /* Заряд помпы и остаток в резервуаре копим из того же снимка (#748). Вопросы к этой копилке
     недельные — «сколько проработает на 1%», «остаток стоит сколько часов», — а в облаке за один
     запрос лежат последние часы. Наполняла её наша загрузка Nightscout, и на телефоне она молчит:
     копилка пустовала, а вместе с ней молча не появлялась подсказка про залипший резервуар. */
  useEffect(() => копитьРядыПриборов(), []);

  /* Ощущение подключения (SugarLifeCore#18). Диффим снимки здесь, а не в компоненте
     ленты: вибро должно случиться, даже когда «Сегодня» не открыт — телефон в кармане,
     сенсор поймался, и человек узнаёт об этом пальцем, а не глазами. */
  useEffect(() => { if (snap) diffBleActivity(snap.devices); }, [snap]);

  /* Разряд моста: предупреждаем один раз и заранее. Когда его батарейка сядет, помпа
     просто перестанет отвечать — снаружи это выглядит как поломка помпы, и человек
     будет искать неисправность там, где её нет (SugarLifeCore#8). */
  const mountBattery = data?.device?.mountBattery ?? null;
  useEffect(() => { checkBridgeBattery(mountBattery); }, [mountBattery]);


  // Если у моста уже есть данные монитора (нативный движок/драйвер) — открываем
  // основной UI, даже без Nightscout. В браузере без нативного моста мост = Nightscout-
  // шим, и при выключенном NS данных нет → показываем экран подключения как раньше.
  const bridgeHasData = !!snap && snap.monitor.glucose !== '—' && snap.monitor.glucose !== '';

  /* Сколько важного в разборе человек ещё не видел — для значка на вкладке «Метрики».
     Расчёт общий с самим разбором и попадает в те же кэши: второго чтения базы не
     происходит (domain/useAnalysis.ts). */
  const { analysis } = useAnalysis(14);
  const виденные = useSeenInsights();
  const новыхНаходок = непрочитанныеВажные(analysis, виденные);

  // Онбординг — главный путь, но не стена (CONNECT-UX §7): показываем, пока ничего не
  // подключено И человек его ещё не прошёл/не пропустил. Пропустил → приложение с прочерками.
  /* И не убегает из-под пальца. Условие входа перестаёт выполняться в ту секунду, когда
     приходит первое показание, — а именно этого мастер и добивается. Получалось, что
     человек заводит сенсор, смотрит на список, и экран под ним сам сменяется на
     «Сегодня»: результат своего действия он не видит и не понимает, было ли оно.

     Открытый мастер закрывается только человеком — «Готово» или «Пропустить». Оба ставят
     флаг, он и гасит. */
  if (status === 'off' && !bridgeHasData && !onboarded) мастерОткрыт.current = true;
  if (onboarded) мастерОткрыт.current = false;
  if (мастерОткрыт.current) {
    return <IonApp><Suspense fallback={<Loader />}><Onboarding /></Suspense></IonApp>;
  }
  if (!data && !bridgeHasData && (status === 'idle' || status === 'loading')) return <IonApp><Loader /></IonApp>;

  /* Первого снимка ещё не было — показываем ожидание, а не пустую оболочку (#420).

     В нативе `status` у нашего стора равен 'off', пока не настроено ни одного облака, —
     и условие выше не срабатывает. Получалась серая оболочка с пустыми экранами: панель
     с прочерками, вкладки, и ничего внутри. Ровно это и видели на живом приборе, когда
     снимок стоял в очереди за добором истории.

     Только для натива и только до ПЕРВОГО снимка. Дальше данные могут пропадать и
     возвращаться — это уже другая история, и рассказывают её экраны, у которых есть что
     показать: последнее известное значение важнее пустоты. */
  if (isNative && !snap) return <IonApp><ПервыйСнимок /></IonApp>;

  return (
    <IonApp>
      <div className="app-shell">
        <HeroPanel />
        <Pager />
        <TabBar insIcon={insIcon} новых={новыхНаходок} />
      </div>
      <InstallPrompt />
    </IonApp>
  );
}
