import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { pulse, flash, moon, nutrition, medkit } from 'ionicons/icons';
import { useStore } from '../data/store';
import { toUnits, agoText, fmt } from '../data/units';
import { arrowChar } from '../data/nightscout';
import { useTheme } from '../theme/useTheme';

const DASH = '—';

export default function Today() {
  const { data, live } = useStore();
  const { toggle } = useTheme();
  const history = useHistory();
  const latest = data?.latest || null;
  const dev = data?.device || null;

  const glucose = latest ? toUnits(latest.mmol) : DASH;
  const arrow = latest ? arrowChar(latest.dir) : '';
  const ago = latest ? agoText(latest.t) : DASH;
  const minsAgo = latest ? Math.round((Date.now() - latest.t) / 60000) : null;
  const fresh = minsAgo == null ? DASH : minsAgo < 1 ? 'сейчас' : minsAgo + ' мин';

  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : DASH;
  const pumpStatus = dev?.status || DASH;
  const cob = dev?.cob != null ? String(Math.round(dev.cob)) : DASH;
  const iob = dev?.iob != null ? fmt(dev.iob) : DASH;

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen">
          <div className="sync-row">
            <span className="sync"><span className="heart">♥</span> {live ? 'реальное время' : latest ? 'Обновлено ' + agoText(data!.updatedAt) : 'Нет данных'}</span>
            <button className="theme-btn" onClick={toggle} aria-label="Тема"><IonIcon icon={moon} /></button>
          </div>

          {/* три кнопки — НМГ | круг | Помпа */}
          <div className="hero">
            <div className="hero-rect">
              <button className="hero-btn hero-nmg" onClick={() => history.push('/mon')}>
                <span className="wing-ico"><IonIcon icon={pulse} /></span>
                <span className="wing-head">
                  <span className="wing-title">НМГ</span>
                  {live && <span className="badge"><span className="dot" />live</span>}
                </span>
                <span className="wing-sub">обновлено</span>
                <span className="wing-val">{fresh}</span>
              </button>

              <div className="hero-gap" />

              <button className="hero-btn hero-pump" onClick={() => history.push('/ins')}>
                <span className="wing-ico"><IonIcon icon={flash} /></span>
                <span className="wing-title">Помпа</span>
                <span className="wing-sub">{pumpStatus}</span>
                <span className="wing-val">{reservoir}</span>
                <span className="wing-sub">резервуар</span>
              </button>
            </div>

            <button className="hero-circle" onClick={() => history.push('/mon')} aria-label="Глюкоза">
              <span className="circle-val">
                <span>{glucose}</span>
                {arrow && <span className="circle-arrow">{arrow}</span>}
              </span>
              <span className="circle-unit">ммоль/л</span>
              <span className="circle-ago">{ago}</span>
            </button>
          </div>

          {/* живые показатели: активные углеводы и активный инсулин */}
          <div className="today-stats">
            <button className="today-stat" onClick={() => history.push('/ins')}>
              <IonIcon icon={nutrition} style={{ color: 'var(--c-carb)' }} />
              <div className="today-stat-val">{cob}<i> г</i></div>
              <div className="today-stat-label">активные углеводы</div>
            </button>
            <button className="today-stat" onClick={() => history.push('/ins')}>
              <IonIcon icon={medkit} style={{ color: 'var(--c-ins)' }} />
              <div className="today-stat-val">{iob}<i> ед</i></div>
              <div className="today-stat-label">активный инсулин</div>
            </button>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
