import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { reportContentScroll } from '../data/panel';
import { hardwareChipOutline, chevronForward } from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useEntries } from '../data/db';
import { toUnits, useUnit } from '../data/units';
import { arrowChar, getCfg, loadEventsRange, type Treatment } from '../data/nightscout';
import { deviceAges } from '../data/treatmentStats';
import GlucoseTimeChart from '../components/GlucoseTimeChart';
import DeviceSheet from '../components/DeviceSheet';
import { DataGate } from '../components/NotConfigured';
import { useStack } from '../data/stack';

const WINDOWS = [1, 3, 6, 12, 24];

const fmtWhen = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} в ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Mon() {
  useUnit(); // перерисовка при смене единиц
  const [win, setWin] = useState(3);
  const { push, pop } = useStack();
  const entries = useEntries(24 * 3600e3);

  const cfg = getCfg();
  const [events, setEvents] = useState<Treatment[]>([]);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      loadEventsRange(cfg.url, cfg.token, 30).then((e) => { if (!cancel) setEvents(e); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.enabled]);
  const ages = deviceAges(events);

  const readings = entries.slice(-8).reverse();

  return (
    <IonPage>
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen screen-pad">
          <DataGate>
          {/* сахар/тренд/свежесть — в верхней панели; здесь кнопка датчика + график */}
          {ages.sensor && (
            <button className="pump-btn" style={{ marginTop: 0 }} onClick={() => push(<DeviceSheet cat="sensor" title="Сенсор (НМГ)" onClose={pop} />)}>
              <IonIcon icon={hardwareChipOutline} className="pump-btn-ico" style={{ color: 'var(--color-accent)' }} />
              <div className="pump-btn-txt">
                <div className="pump-btn-title">Датчик</div>
                <div className="pump-btn-sub">День {ages.sensor.days + 1} · установлен {fmtWhen(ages.sensor.at)}</div>
              </div>
              <IonIcon icon={chevronForward} className="pump-btn-chev" />
            </button>
          )}

          {/* период */}
          <div className="win-chips">
            {WINDOWS.map((w) => (
              <button key={w} className={'win-chip' + (win === w ? ' on' : '')} onClick={() => setWin(w)}>{w}ч</button>
            ))}
          </div>

          {/* график */}
          <GlucoseTimeChart entries={entries} windowH={win} />

          {/* последние измерения */}
          <div className="section-label sec">Последние измерения</div>
          <div className="list">
            {readings.map((e, i) => (
              <div key={e.t} className="reading-row" style={i === 0 ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' } : undefined}>
                <span className="reading-time" style={{ fontWeight: i === 0 ? 600 : 400 }}>
                  {new Date(e.t).getHours().toString().padStart(2, '0')}:{new Date(e.t).getMinutes().toString().padStart(2, '0')}
                </span>
                <span className="reading-val" style={{ fontWeight: i === 0 ? 600 : 400 }}>{toUnits(e.mmol)}</span>
                <span className="reading-arrow">{arrowChar(e.dir)}</span>
              </div>
            ))}
            {!readings.length && <div className="mon-empty">Нет данных.</div>}
          </div>

          <div className="metric-note">День датчика — из события замены сенсора в Nightscout (Sensor Change). Сахар, тренд и свежесть — вживую.</div>
          </DataGate>
        </div>
      </IonContent>
    </IonPage>
  );
}
