import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { reportContentScroll } from '../data/panel';
import { flash, repeat, chevronForward } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { useTreatments } from '../data/db';
import { detectTherapy } from '../data/therapy';
import { fmt } from '../data/units';
import { useCloseOnLeave } from '../data/nav';
import InsulinTimeChart from '../components/InsulinTimeChart';
import DeviceSheet from '../components/DeviceSheet';
import NotConfigured from '../components/NotConfigured';

const WINDOWS = [1, 3, 6, 12, 24];

export default function Ins() {
  const { data } = useStore();
  const dev = data?.device || null;
  const profile = data?.profile || null;
  const therapy = detectTherapy(data);
  const isPen = therapy === 'pen';

  const [win, setWin] = useState(3);
  const [pumpOpen, setPumpOpen] = useState(false);
  const [loopOpen, setLoopOpen] = useState(false);
  useCloseOnLeave(3, () => setPumpOpen(false), () => setLoopOpen(false)); // «Инсулин» — закрыть шторки при уходе

  // Живьём из локальной БД (обновляется сокетом/бэкфиллом): раньше грузили один раз
  // на старте — новые болюсы в график не попадали, пока не перезапустишь приложение.
  const treatments = useTreatments(31 * 3600e3); // 24ч окна графика + запас на ступень базала
  const tempBasals = treatments.filter((t) => t.type === 'Temp Basal');
  const boluses = treatments.filter((t) => t.type !== 'Temp Basal' && (t.insulin ?? 0) > 0);
  const baseBasal = dev?.baseBasal ?? profile?.basal ?? null;
  const pumpStatus = dev?.status || (therapy === 'loop' ? 'Замкнутый цикл' : 'Помпа');
  const baseBasalTxt = dev?.baseBasal != null ? fmt(dev.baseBasal) : profile?.basal != null ? fmt(profile.basal) : '—';

  return (
    <IonPage>
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen screen-pad">
          {/* не настроено — заметный выход к мастеру */}
          <NotConfigured compact />

          {isPen ? (
            <div className="basal-card">
              <div className="basal-head"><IonIcon icon={flash} style={{ color: 'var(--c-ins)' }} /><span>Шприц-ручка</span></div>
              <div className="basal-rows">
                <div className="basal-row"><span>Последняя инъекция</span><b>{dev?.lastBolus != null ? fmt(dev.lastBolus) + ' ед' : '—'}</b></div>
                <div className="basal-row"><span>Активный инсулин</span><b>{dev?.iob != null ? fmt(dev.iob) + ' ед' : '—'}</b></div>
              </div>
            </div>
          ) : (
            <>
              {/* помпа (шторка) + петля (шторка) */}
              <div className="pump-row">
                <button className="pump-btn" onClick={() => setPumpOpen(true)}>
                  <IonIcon icon={flash} className="pump-btn-ico" />
                  <div className="pump-btn-txt">
                    <div className="pump-btn-title">Помпа</div>
                    <div className="pump-btn-sub">{pumpStatus} · базал {baseBasalTxt} ед/ч</div>
                  </div>
                  <IonIcon icon={chevronForward} className="pump-btn-chev" />
                </button>
                <button className="loop-btn" onClick={() => setLoopOpen(true)} aria-label="Петля">
                  <IonIcon icon={repeat} />
                </button>
              </div>

              {/* график подачи инсулина — наверху, как график НМГ */}
              <div className="win-chips">
                {WINDOWS.map((w) => (
                  <button key={w} className={'win-chip' + (win === w ? ' on' : '')} onClick={() => setWin(w)}>{w}ч</button>
                ))}
              </div>
              <InsulinTimeChart tempBasals={tempBasals} boluses={boluses} windowH={win} baseBasal={baseBasal} />
              <div className="chart-legend">
                <span className="lg-item"><i className="lg-dot" style={{ background: 'var(--c-ins)' }} />базал, ед/ч</span>
                <span className="lg-item"><i className="lg-dot" style={{ background: 'var(--c-carb)' }} />болюс, ед</span>
                <span className="lg-item"><i className="lg-dash" />базовая скорость</span>
              </div>
            </>
          )}
        </div>

        {/* одна карточка устройства на всё приложение (§7) — та же, что в «Профиль → Устройства» */}
        <DeviceSheet isOpen={pumpOpen} onClose={() => setPumpOpen(false)} cat="pump" title="Ввод инсулина" />
        <DeviceSheet isOpen={loopOpen} onClose={() => setLoopOpen(false)} cat="loop" title="Петля" />
      </IonContent>
    </IonPage>
  );
}
