import { IonPage, IonContent, IonIcon, useIonViewWillLeave } from '@ionic/react';
import {
  personCircle, chevronForward, notificationsOutline, optionsOutline,
  cloudDownloadOutline, shareSocialOutline, personOutline,
  ellipse, sunny, moon,
} from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { getCfg } from '../data/nightscout';
import { useTheme } from '../theme/useTheme';
import NightscoutModal from '../components/NightscoutModal';

export default function Profile() {
  const { status } = useStore();
  const { theme, setTheme } = useTheme();
  const [nsOpen, setNsOpen] = useState(false);
  useIonViewWillLeave(() => setNsOpen(false));

  const cfg = getCfg();
  const nsValue = !cfg || !cfg.enabled ? 'выкл'
    : status === 'ok' ? 'подключено'
    : status === 'loading' ? 'подключение…'
    : (status === 'error' || status === 'stale') ? 'нет связи' : '—';

  const themes: { key: 'system' | 'light' | 'dark'; label: string; icon: string }[] = [
    { key: 'system', label: 'Системная', icon: ellipse },
    { key: 'light', label: 'Светлая', icon: sunny },
    { key: 'dark', label: 'Тёмная', icon: moon },
  ];

  const rows = [
    { icon: personOutline, title: 'Персональные данные', value: 'Алексей М.', onClick: undefined },
    { icon: notificationsOutline, title: 'Уведомления', value: '4/5', onClick: undefined },
    { icon: optionsOutline, title: 'Единицы измерения', value: 'ммоль/л · г', onClick: undefined },
    { icon: cloudDownloadOutline, title: 'Nightscout', value: nsValue, onClick: () => setNsOpen(true) },
    { icon: cloudDownloadOutline, title: 'Экспорт в файл', value: 'PDF', onClick: undefined },
    { icon: shareSocialOutline, title: 'Врач и близкие', value: '2 человека', onClick: undefined },
  ];

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen screen-pad">
          {/* профиль */}
          <div className="profile-head">
            <div className="avatar"><IonIcon icon={personCircle} /></div>
            <div>
              <div className="profile-name">Алексей М.</div>
              <div className="profile-sub">СД 1 типа · с 2014 года</div>
            </div>
          </div>

          {/* показатели */}
          <div className="stat-row">
            <div className="stat"><div className="stat-label">HbA1c</div><div className="stat-val">6,8<span>%</span></div></div>
            <div className="stat"><div className="stat-label">Вес</div><div className="stat-val">74<span>кг</span></div></div>
            <div className="stat"><div className="stat-label">СУИ</div><div className="stat-val">1:8</div></div>
          </div>

          {/* оформление */}
          <div className="section-label sec">Оформление</div>
          <div className="theme-chips">
            {themes.map((t) => {
              const on = theme === t.key;
              return (
                <button key={t.key} className={'theme-chip' + (on ? ' on' : '')} onClick={() => setTheme(t.key)}>
                  <IonIcon icon={t.icon} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* настройки */}
          <div className="section-label sec">Настройки</div>
          <div className="list">
            {rows.map((r, i) => (
              <button key={i} className="list-row" onClick={r.onClick} disabled={!r.onClick}>
                <IonIcon icon={r.icon} className="list-ico" />
                <span className="list-title">{r.title}</span>
                <span className="list-value">{r.value}</span>
                <IonIcon icon={chevronForward} className="list-chev" />
              </button>
            ))}
          </div>

          <button className="logout">Выйти из аккаунта</button>
        </div>

        <NightscoutModal isOpen={nsOpen} onClose={() => setNsOpen(false)} />
      </IonContent>
    </IonPage>
  );
}
