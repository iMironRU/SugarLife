import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { pulse, flash, moon } from 'ionicons/icons';
import { useStore } from '../data/store';
import { toUnits, agoText } from '../data/units';
import { arrowChar } from '../data/nightscout';
import { useTheme } from '../theme/useTheme';

export default function Today() {
  const { data, status } = useStore();
  const { toggle } = useTheme();
  const history = useHistory();
  const live = data && data.latest ? data : null;
  const dev = live?.device || null;

  const glucose = live ? toUnits(live.latest!.mmol) : '5,8';
  const arrow = live ? arrowChar(live.latest!.dir) : '↗';
  const ago = live ? agoText(live.latest!.t) : '3 мин назад';
  const synced = live ? 'Обновлено ' + agoText(data!.updatedAt) : status === 'off' ? 'Демо-данные' : 'Синхронизация…';
  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : '112 ед';

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen">
          {/* строка синхронизации + тема */}
          <div className="sync-row">
            <span className="sync"><span className="heart">♥</span> {synced}</span>
            <button className="theme-btn" onClick={toggle} aria-label="Тема">
              <IonIcon icon={moon} />
            </button>
          </div>

          {/* верхний блок: три кнопки — НМГ | круг | Помпа */}
          <div className="hero">
            <div className="hero-rect">
              <button className="hero-btn hero-nmg" onClick={() => history.push('/mon')}>
                <span className="wing-ico"><IonIcon icon={pulse} /></span>
                <span className="wing-head">
                  <span className="wing-title">НМГ</span>
                  <span className="badge"><span className="dot" />×1</span>
                </span>
                <span className="wing-sub">датчик</span>
                <span className="wing-val">7 дн</span>
                <span className="wing-sub">осталось</span>
              </button>

              <div className="hero-gap" />

              <button className="hero-btn hero-pump" onClick={() => history.push('/ins')}>
                <span className="wing-ico"><IonIcon icon={flash} /></span>
                <span className="wing-title">Помпа</span>
                <span className="wing-sub">Fiasp</span>
                <span className="wing-val">{reservoir}</span>
                <span className="wing-sub">резервуар</span>
              </button>
            </div>

            <button className="hero-circle" aria-label="Глюкоза">
              <span className="circle-val">
                <span>{glucose}</span>
                <span className="circle-arrow">{arrow}</span>
              </span>
              <span className="circle-unit">ммоль/л</span>
              <span className="circle-ago">{ago}</span>
            </button>
          </div>

          {/* плитка еды */}
          <div className="food-tile">
            <div className="macros">
              <div><span>Б</span> <b>62</b> г</div>
              <div><span>Ж</span> <b>48</b> г</div>
              <div><span>У</span> <b>186</b> г</div>
            </div>
            <div className="carbs">
              <div className="carbs-val"><b>42</b> г</div>
              <div className="carbs-sub">активные углеводы</div>
              <div className="carbs-sub2">всего за день · 186 г</div>
            </div>
            <div className="food-cta">
              <div className="food-ico">🍽</div>
              <div className="food-title">Еда</div>
              <div className="carbs-sub">4 приёма</div>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
