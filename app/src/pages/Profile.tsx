import { IonPage, IonContent, IonIcon, useIonViewWillLeave } from '@ionic/react';
import {
  personCircle, chevronForward, notificationsOutline, optionsOutline,
  cloudDownloadOutline, shareSocialOutline, personOutline,
  ellipse, sunny, moon,
} from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { getCfg } from '../data/nightscout';
import { stats } from '../data/agp';
import { detectTherapy, therapyLabel } from '../data/therapy';
import { fmt } from '../data/units';
import { useTheme } from '../theme/useTheme';
import NightscoutModal from '../components/NightscoutModal';

const DASH = '—';

export default function Profile() {
  const { status, data } = useStore();
  const { theme, setTheme } = useTheme();
  const [nsOpen, setNsOpen] = useState(false);
  useIonViewWillLeave(() => setNsOpen(false));

  const cfg = getCfg();
  const nsValue = !cfg || !cfg.enabled ? 'выкл'
    : status === 'ok' ? 'подключено'
    : status === 'loading' ? 'подключение…'
    : (status === 'error' || status === 'stale') ? 'нет связи' : DASH;

  const gs = data?.entries?.length ? stats(data.entries) : null;
  const gmi = gs ? fmt(gs.gmi) : DASH;
  const ic = data?.profile?.ic != null ? '1:' + fmt(data.profile.ic) : DASH;
  const therapy = therapyLabel(detectTherapy(data));

  const themes: { key: 'system' | 'light' | 'dark'; label: string; icon: string }[] = [
    { key: 'system', label: 'Системная', icon: ellipse },
    { key: 'light', label: 'Светлая', icon: sunny },
    { key: 'dark', label: 'Тёмная', icon: moon },
  ];

  const rows = [
    { icon: personOutline, title: 'Персональные данные', value: DASH, onClick: undefined },
    { icon: notificationsOutline, title: 'Уведомления', value: DASH, onClick: undefined },
    { icon: optionsOutline, title: 'Единицы измерения', value: 'ммоль/л', onClick: undefined },
    { icon: cloudDownloadOutline, title: 'Nightscout', value: nsValue, onClick: () => setNsOpen(true) },
    { icon: cloudDownloadOutline, title: 'Экспорт в файл', value: DASH, onClick: undefined },
    { icon: shareSocialOutline, title: 'Врач и близкие', value: DASH, onClick: undefined },
  ];

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen screen-pad">
          {/* профиль */}
          <div className="profile-head">
            <div className="avatar"><IonIcon icon={personCircle} /></div>
            <div>
              <div className="profile-name">Мой профиль</div>
              <div className="profile-sub">{therapy} · Nightscout</div>
            </div>
          </div>

          {/* показатели */}
          <div className="stat-row">
            <div className="stat"><div className="stat-label">GMI (≈HbA1c)</div><div className="stat-val">{gmi}<span>%</span></div></div>
            <div className="stat"><div className="stat-label">Вес</div><div className="stat-val">{DASH}</div></div>
            <div className="stat"><div className="stat-label">СУИ</div><div className="stat-val">{ic}</div></div>
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
