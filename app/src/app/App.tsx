import { IonApp, IonIcon, createGesture } from '@ionic/react';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { barChart, pulse, home, water, personCircle, medkit } from 'ionicons/icons';

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
import InstallPrompt from '@/ui/InstallPrompt';
import HeroPanel from '@/app/HeroPanel';
import { useStore } from '@/sources/store';
import { useSnapshot } from '@/sources/bridge';
import { diffBleActivity } from '@/sources/bleActivity';
import { checkBridgeBattery } from '@/settings/bridgeAlerts';
import { detectTherapy } from '@/domain/therapy';
import { useTab, setTab, pressTab, getTab, TAB_PATHS } from '@/app/nav';
import { useOnboarded } from '@/settings/onboarding';
import { StackHost } from '@/app/stack';
import { requestNotifyPermissionOnStart } from '@/platform/notify';
import { startHistorySync } from '@/sources/historySync';
import { прогретьРазделы } from '@/sections/lazy';
import { прогретьГрафик } from '@/charts/warm';

// Порядок вкладок: 0 Метрики · 1 НМГ · 2 Сегодня · 3 Инсулин · 4 Профиль
function Pager() {
  const idx = useTab();
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

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
        <div data-tab={2} className={'pager-pane' + (idx === 2 ? ' is-active' : '')}><StackHost tab={2}><Today /></StackHost></div>
        <div data-tab={3} className={'pager-pane' + (idx === 3 ? ' is-active' : '')}><StackHost tab={3}><Ins /></StackHost></div>
        <div data-tab={4} className={'pager-pane' + (idx === 4 ? ' is-active' : '')}><StackHost tab={4}><Profile /></StackHost></div>
      </div>
    </div>
  );
}

function TabBar({ insIcon }: { insIcon: string }) {
  const idx = useTab();
  const tabs = [
    { i: 0, label: 'Метрики', icon: barChart },
    { i: 1, label: 'НМГ', icon: pulse },
    { i: 2, label: 'Сегодня', icon: home },
    { i: 3, label: 'Инсулин', icon: insIcon },
    { i: 4, label: 'Профиль', icon: personCircle },
  ];
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <button key={t.i} className={'tab' + (idx === t.i ? ' on' : '')} onClick={() => pressTab(t.i)}>
          <IonIcon icon={t.icon} />
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
  const insIcon = detectTherapy(data) === 'pen' ? medkit : water;

  // Спрашиваем разрешение на уведомления сразу при старте (не ждём первого
  // реального события) — так пользователь явно видит и решает.
  useEffect(() => { requestNotifyPermissionOnStart(); }, []);

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

  // Онбординг — главный путь, но не стена (CONNECT-UX §7): показываем, пока ничего не
  // подключено И человек его ещё не прошёл/не пропустил. Пропустил → приложение с прочерками.
  if (status === 'off' && !bridgeHasData && !onboarded) {
    return <IonApp><Suspense fallback={<Loader />}><Onboarding /></Suspense></IonApp>;
  }
  if (!data && !bridgeHasData && (status === 'idle' || status === 'loading')) return <IonApp><Loader /></IonApp>;

  return (
    <IonApp>
      <div className="app-shell">
        <HeroPanel />
        <Pager />
        <TabBar insIcon={insIcon} />
      </div>
      <InstallPrompt />
    </IonApp>
  );
}
