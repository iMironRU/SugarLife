import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { pulse, batteryHalf, wifi, cloudOffline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { toUnits, agoText } from '../data/units';
import { arrowChar } from '../data/nightscout';
import GlucoseTimeChart from '../components/GlucoseTimeChart';

const WINDOWS = [1, 3, 6, 12, 24];

export default function Mon() {
  const { data, status, live } = useStore();
  const [win, setWin] = useState(3);
  const entries = data?.entries || [];
  const latest = data?.latest || null;
  const dev = data?.device || null;

  const now = Date.now();
  const minsAgo = latest ? Math.round((now - latest.t) / 60000) : null;
  const stale = minsAgo != null && minsAgo > 15;

  const readings = entries.slice(-8).reverse();

  return (
    <IonPage>
      <IonContent fullscreen>
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
            <div className="mon-stat">
              <IonIcon icon={batteryHalf} style={{ color: 'var(--color-accent)' }} />
              <div className="mon-stat-val">{dev?.uploaderBattery != null ? dev.uploaderBattery + '%' : '—'}</div>
              <div className="mon-stat-label">телефон</div>
            </div>
          </div>

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

          <div className="metric-note">Данные датчика (модель, возраст, калибровка) ваш Nightscout не передаёт — добавим ручной учёт сенсора позже. Здесь — всё, что есть вживую: сахар, график, свежесть, батарея телефона петли.</div>
        </div>
      </IonContent>
    </IonPage>
  );
}
