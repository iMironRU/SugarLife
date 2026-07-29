import { IonPage, IonContent } from '@ionic/react';
import { useStore } from '../data/store';
import { toUnits, agoText } from '../data/units';
import { arrowChar } from '../data/nightscout';
import { useTheme } from '../theme/useTheme';

export default function Today() {
  const { data, status } = useStore();
  const { theme, toggle } = useTheme();
  const live = data && data.latest ? data : null;
  const dev = live?.device || null;

  const glucose = live ? toUnits(live.latest!.mmol) : '5,8';
  const arrow = live ? arrowChar(live.latest!.dir) : '↗';
  const ago = live ? agoText(live.latest!.t) : '3 мин назад';
  const synced = live ? 'Обновлено ' + agoText(data!.updatedAt) : status === 'off' ? 'Демо-данные' : 'Синхронизация…';
  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : '112 ед';

  return (
    <IonPage>
      <IonContent fullscreen className="today-content">
        <div className="screen">
          {/* строка синхронизации + тема */}
          <div className="sync-row">
            <span className="sync"><span className="heart">♥</span> {synced}</span>
            <button className="theme-btn" onClick={toggle} aria-label="Тема">{theme === 'light' ? '☾' : '☾'}</button>
          </div>

          {/* верхний блок: крылья + круг */}
          <div className="hero">
            <div className="wing">
              <div className="wing-ico" style={{ color: 'var(--color-accent)' }}>∿</div>
              <div className="wing-title">НМГ</div>
              <div className="wing-sub">датчик</div>
              <div className="wing-val">7 дн</div>
              <div className="wing-sub">осталось</div>
            </div>

            <div className="circle">
              <div className="circle-val">
                <span>{glucose}</span>
                <span className="circle-arrow">{arrow}</span>
              </div>
              <div className="circle-unit">ммоль/л</div>
              <div className="circle-ago">{ago}</div>
            </div>

            <div className="wing wing-r">
              <div className="wing-ico" style={{ color: 'var(--color-accent)' }}>⌁</div>
              <div className="wing-title">Помпа</div>
              <div className="wing-sub">Fiasp</div>
              <div className="wing-val">{reservoir}</div>
              <div className="wing-sub">резервуар</div>
            </div>
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
