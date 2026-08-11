import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useTab } from '@/app/nav';
import { DeviceSection, LoopSetupSection } from '@/sections/lazy';
import { reportContentScroll } from '@/app/panel';
import { flash, repeat, chevronForward } from 'ionicons/icons';
import { useState } from 'react';
import { useStorePart } from '@/sources/store';
import { useTreatments } from '@/sources/db';
import { detectTherapy } from '@/domain/therapy';
import { fmt } from '@/domain/units';
import InsulinTimeChart from '@/charts/InsulinTimeChart';
import { DataGate } from '@/ui/NotConfigured';
import { useStack } from '@/app/stackCtx';

const WINDOWS = [1, 3, 6, 12, 24];

export default function Ins() {
  /* Вкладка видна? Все пять смонтированы разом ради свайпа, но читать базу
     невидимому экрану незачем — это и были рывки на соседних вкладках. */
  const активна = useTab() === 3;
  /* Берём только то, что рисуем: статус помпы, профиль и тип терапии. Раньше экран
     подписывался на весь стор и перерисовывался от каждого нового измерения, хотя
     измерения здесь не показываются вовсе. */
  const dev = useStorePart((s) => s.data?.device ?? null);
  const profile = useStorePart((s) => s.data?.profile ?? null);
  const therapy = useStorePart((s) => detectTherapy(s.data));
  const isPen = therapy === 'pen';

  const [win, setWin] = useState(3);
  const { push, pop } = useStack();

  // Живьём из локальной БД (обновляется сокетом/бэкфиллом): раньше грузили один раз
  // на старте — новые болюсы в график не попадали, пока не перезапустишь приложение.
  const treatments = useTreatments(31 * 3600e3, { paused: !активна }); // 24ч окна графика + запас на ступень базала
  const tempBasals = treatments.filter((t) => t.type === 'Temp Basal');
  const boluses = treatments.filter((t) => t.type !== 'Temp Basal' && (t.insulin ?? 0) > 0);
  const baseBasal = dev?.baseBasal ?? profile?.basal ?? null;
  const pumpStatus = dev?.status || (therapy === 'loop' ? 'Замкнутый цикл' : 'Помпа');
  const baseBasalTxt = dev?.baseBasal != null ? fmt(dev.baseBasal) : profile?.basal != null ? fmt(profile.basal) : '—';

  return (
    <IonPage>
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen screen-pad">
          <DataGate>
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
                <button className="pump-btn" onClick={() => push(<DeviceSection cat="pump" title="Ввод инсулина" onClose={pop} />)}>
                  <IonIcon icon={flash} className="pump-btn-ico" />
                  <div className="pump-btn-txt">
                    <div className="pump-btn-title">Помпа</div>
                    <div className="pump-btn-sub">{pumpStatus} · базал {baseBasalTxt} ед/ч</div>
                  </div>
                  <IonIcon icon={chevronForward} className="pump-btn-chev" />
                </button>
                <button className="loop-btn" onClick={() => push(<LoopSetupSection onClose={pop} />)} aria-label="Петля">
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
          </DataGate>
        </div>

      </IonContent>
    </IonPage>
  );
}
