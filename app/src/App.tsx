import { IonApp, IonIcon, createGesture } from '@ionic/react';
import { useEffect, useRef } from 'react';
import { barChart, pulse, home, water, personCircle, medkit } from 'ionicons/icons';

import Today from './pages/Today';
import Profile from './pages/Profile';
import Metrics from './pages/Metrics';
import Mon from './pages/Mon';
import Ins from './pages/Ins';
import Connect from './pages/Connect';
import Loader from './pages/Loader';
import InstallPrompt from './components/InstallPrompt';
import HeroPanel from './components/HeroPanel';
import { useStore } from './data/store';
import { useSnapshot } from './data/bridge';
import { detectTherapy } from './data/therapy';
import { useTab, setTab, getTab, TAB_PATHS } from './data/nav';

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
        <div className={'pager-pane' + (idx === 0 ? ' is-active' : '')}><Metrics /></div>
        <div className={'pager-pane' + (idx === 1 ? ' is-active' : '')}><Mon /></div>
        <div className={'pager-pane' + (idx === 2 ? ' is-active' : '')}><Today /></div>
        <div className={'pager-pane' + (idx === 3 ? ' is-active' : '')}><Ins /></div>
        <div className={'pager-pane' + (idx === 4 ? ' is-active' : '')}><Profile /></div>
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
        <button key={t.i} className={'tab' + (idx === t.i ? ' on' : '')} onClick={() => setTab(t.i)}>
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
  const insIcon = detectTherapy(data) === 'pen' ? medkit : water;

  // Если у моста уже есть данные монитора (нативный движок/драйвер) — открываем
  // основной UI, даже без Nightscout. В браузере без нативного моста мост = Nightscout-
  // шим, и при выключенном NS данных нет → показываем экран подключения как раньше.
  const bridgeHasData = !!snap && snap.monitor.glucose !== '—' && snap.monitor.glucose !== '';

  // Гейт: не подключён и мост пуст → форма; подключён, но данных ещё нет → лоадер.
  if (status === 'off' && !bridgeHasData) return <IonApp><Connect /></IonApp>;
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
