import { IonPage, IonContent, IonIcon, useIonViewWillLeave } from '@ionic/react';
import {
  personCircle, chevronForward, cloudDownloadOutline, downloadOutline,
  ellipse, sunny, moon,
} from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore } from '../data/store';
import { getCfg, setCfg } from '../data/nightscout';
import { stats } from '../data/agp';
import { detectTherapy, therapyLabel } from '../data/therapy';
import { fmt, toUnits, unitLabel, useUnit, setUnit, type Unit } from '../data/units';
import { countEntries } from '../data/db';
import { exportGlucoseCsv } from '../data/export';
import { useTheme } from '../theme/useTheme';
import NightscoutModal from '../components/NightscoutModal';

const DASH = '—';

export default function Profile() {
  const { status, data } = useStore();
  const { theme, setTheme } = useTheme();
  const unit = useUnit();
  const [nsOpen, setNsOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  useIonViewWillLeave(() => setNsOpen(false));

  useEffect(() => { countEntries().then(setCount).catch(() => setCount(null)); }, [data]);

  const cfg = getCfg();
  const nsValue = !cfg || !cfg.enabled ? 'выкл'
    : status === 'ok' ? 'подключено'
    : status === 'loading' ? 'подключение…'
    : (status === 'error' || status === 'stale') ? 'нет связи' : DASH;

  const reset = () => {
    if (!window.confirm('Сбросить настройки? Адрес Nightscout и локальная история глюкозы будут удалены с этого устройства.')) return;
    setCfg(null);
    try { localStorage.removeItem('sl.ns.cache.v1'); } catch { /* ignore */ }
    try { indexedDB.deleteDatabase('sugarlife'); } catch { /* ignore */ }
    location.reload();
  };

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const n = await exportGlucoseCsv();
      setExportMsg(n ? `Файл готов · ${n} записей` : 'Нет данных для экспорта');
    } catch {
      setExportMsg('Не удалось выгрузить');
    }
    setExporting(false);
    window.setTimeout(() => setExportMsg(null), 4000);
  };

  const gs = data?.entries?.length ? stats(data.entries) : null;
  const gmi = gs ? fmt(gs.gmi) : DASH;
  const mean = gs ? toUnits(gs.mean) : DASH;

  const units: { key: Unit; label: string }[] = [
    { key: 'mmol', label: 'ммоль/л' },
    { key: 'mgdl', label: 'мг/дл' },
  ];
  const ic = data?.profile?.ic != null ? '1:' + fmt(data.profile.ic) : DASH;
  const therapy = therapyLabel(detectTherapy(data));
  const name = data?.profile?.name || 'Профиль';

  const themes: { key: 'system' | 'light' | 'dark'; label: string; icon: string }[] = [
    { key: 'system', label: 'Системная', icon: ellipse },
    { key: 'light', label: 'Светлая', icon: sunny },
    { key: 'dark', label: 'Тёмная', icon: moon },
  ];

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen screen-pad">
          {/* профиль */}
          <div className="profile-head">
            <div className="avatar"><IonIcon icon={personCircle} /></div>
            <div>
              <div className="profile-name">{name}</div>
              <div className="profile-sub">{therapy} · Nightscout</div>
            </div>
          </div>

          {/* показатели */}
          <div className="stat-row">
            <div className="stat"><div className="stat-label">GMI (≈HbA1c)</div><div className="stat-val">{gmi}<span>%</span></div></div>
            <div className="stat"><div className="stat-label">Ср. сахар</div><div className="stat-val">{mean}<span>{unitLabel()}</span></div></div>
            <div className="stat"><div className="stat-label">СУИ</div><div className="stat-val">{ic}</div></div>
          </div>

          {/* единицы */}
          <div className="section-label sec">Единицы глюкозы</div>
          <div className="theme-chips">
            {units.map((u) => (
              <button key={u.key} className={'theme-chip' + (unit === u.key ? ' on' : '')} onClick={() => setUnit(u.key)}>
                <span>{u.label}</span>
              </button>
            ))}
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
            <button className="list-row" onClick={() => setNsOpen(true)}>
              <IonIcon icon={cloudDownloadOutline} className="list-ico" />
              <span className="list-title">Nightscout</span>
              <span className="list-value">{nsValue}</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
            <button className="list-row" onClick={doExport} disabled={exporting}>
              <IonIcon icon={downloadOutline} className="list-ico" />
              <span className="list-title">Экспорт глюкозы в CSV</span>
              <span className="list-value">{exporting ? 'выгрузка…' : count != null ? `${count} зап.` : DASH}</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
          </div>
          {exportMsg && <div className="metric-note" style={{ marginTop: 8 }}>{exportMsg}</div>}

          <div className="metric-note" style={{ marginTop: 14 }}>
            Данные хранятся только на этом устройстве, без облака и аккаунта.
          </div>

          <button className="logout" onClick={reset}>Сбросить настройки</button>
        </div>

        <NightscoutModal isOpen={nsOpen} onClose={() => setNsOpen(false)} />
      </IonContent>
    </IonPage>
  );
}
