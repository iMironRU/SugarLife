import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { setPanelScrolled } from '../data/panel';
import { pulse, wifi, cloudOffline, hardwareChipOutline } from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore } from '../data/store';
import { useEntries } from '../data/db';
import { toUnits, agoText, useUnit } from '../data/units';
import { arrowChar, getCfg, loadEventsRange, type Treatment } from '../data/nightscout';
import { deviceAges } from '../data/treatmentStats';
import GlucoseTimeChart from '../components/GlucoseTimeChart';

const WINDOWS = [1, 3, 6, 12, 24];

const fmtWhen = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} в ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Mon() {
  const { data, status, live } = useStore();
  useUnit(); // перерисовка при смене единиц
  const [win, setWin] = useState(3);
  const entries = useEntries(24 * 3600e3);
  const latest = data?.latest || null;

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

  const now = Date.now();
  const minsAgo = latest ? Math.round((now - latest.t) / 60000) : null;
  const stale = minsAgo != null && minsAgo > 15;

  const readings = entries.slice(-8).reverse();

  return (
    <IonPage>
      <IonContent fullscreen scrollEvents onIonScroll={(e) => setPanelScrolled(e.detail.scrollTop > 10)}>
        <div className="screen screen-pad">
          <div className="mon-head">
            <div>
              <div className="mon-title">НМГ</div>
              <div className="mon-sub">{live ? 'реальное время' : status === 'off' ? 'демо' : 'поллинг'}</div>
            </div>
            {latest && (
              <div className="mon-now">
                <span className="mon-now-val">{toUnits(latest.mmol)}</span>
                <span className="mon-now-arrow">{arrowChar(latest.dir)}</span>
                <span className="mon-now-ago">{agoText(latest.t)}</span>
              </div>
            )}
          </div>

          {/* статус источника */}
          <div className="mon-status">
            <div className="mon-stat">
              <IonIcon icon={live ? wifi : cloudOffline} style={{ color: live ? 'var(--c-glu)' : 'var(--color-neutral-500)' }} />
              <div className="mon-stat-val">{live ? 'Онлайн' : status === 'off' ? '—' : 'Поллинг'}</div>
              <div className="mon-stat-label">связь</div>
            </div>
            <div className="mon-stat">
              <IonIcon icon={pulse} style={{ color: stale ? 'var(--c-danger)' : 'var(--c-glu)' }} />
              <div className="mon-stat-val">{minsAgo != null ? (minsAgo < 1 ? 'сейчас' : minsAgo + ' мин') : '—'}</div>
              <div className="mon-stat-label">{stale ? 'нет данных' : 'обновлено'}</div>
            </div>
          </div>

          {/* датчик и расходники */}
          {ages.sensor && (
            <>
              <div className="section-label sec">Датчик</div>
              <div className="sensor-card">
                <div className="sensor-main">
                  <IonIcon icon={hardwareChipOutline} />
                  <div>
                    <div className="sensor-day">День {ages.sensor.days + 1}</div>
                    <div className="sensor-when">установлен {fmtWhen(ages.sensor.at)}</div>
                  </div>
                </div>
              </div>
            </>
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
            {!readings.length && <div className="mon-empty">Нет данных. Подключите Nightscout в профиле.</div>}
          </div>

          <div className="metric-note">День датчика — из события замены сенсора в Nightscout (Sensor Change). Сахар, тренд и свежесть — вживую.</div>
        </div>
      </IonContent>
    </IonPage>
  );
}
