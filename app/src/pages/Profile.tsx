import { IonPage, IonContent, IonIcon, useIonViewWillLeave } from '@ionic/react';
import {
  personCircle, chevronForward, cloudDownloadOutline, downloadOutline,
  optionsOutline, ellipse, sunny, moon, refreshOutline,
} from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore } from '../data/store';
import { getCfg, setCfg } from '../data/nightscout';
import { stats } from '../data/agp';
import { detectTherapy, therapyLabel } from '../data/therapy';
import { fmt, toUnits, unitLabel, useUnit } from '../data/units';
import { countEntries } from '../data/db';
import { exportGlucoseCsv } from '../data/export';
import { useTheme } from '../theme/useTheme';
import { APP_VERSION, APP_BUILD, isNative, checkWebUpdate } from '../data/appUpdate';
import NightscoutModal from '../components/NightscoutModal';
import UnitsModal from '../components/UnitsModal';

const DASH = '—';

export default function Profile() {
  const { status, data } = useStore();
  const { theme, setTheme } = useTheme();
  const unit = useUnit();
  const [nsOpen, setNsOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  useIonViewWillLeave(() => { setNsOpen(false); setUnitsOpen(false); });

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

  const doUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateMsg(null);
    const r = await checkWebUpdate();
    setUpdating(false);
    if (r === 'current') setUpdateMsg('У вас последняя версия.');
    else if (r === 'error') setUpdateMsg('Не удалось проверить обновление.');
    // 'updated' → приложение перезагрузится само
    if (r === 'current') window.setTimeout(() => setUpdateMsg(null), 4000);
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
            <div className="stat"><div className="stat-label">СУИ</div><div className="stat-val">{ic}<span></span></div></div>
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
            <button className="list-row" onClick={() => setUnitsOpen(true)}>
              <IonIcon icon={optionsOutline} className="list-ico" />
              <span className="list-title">Единицы измерения</span>
              <span className="list-value">{unitLabel(unit)}</span>
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

          {/* о приложении: версия + сборка + обновление */}
          <div className="section-label sec">О приложении</div>
          <div className="about">
            <div className="about-info">
              <div className="about-ver">Версия {APP_VERSION}</div>
              <div className="about-build">сборка {APP_BUILD}{isNative ? ' · нативное' : ' · PWA'}</div>
            </div>
            <button className="about-update" onClick={doUpdate} disabled={updating}>
              <IonIcon icon={refreshOutline} className={updating ? 'spin' : ''} />
              {updating ? 'Проверяю…' : 'Обновиться'}
            </button>
          </div>
          {updateMsg && <div className="metric-note" style={{ marginTop: 8 }}>{updateMsg}</div>}

          <button className="logout" onClick={reset}>Сбросить настройки</button>
        </div>

        <NightscoutModal isOpen={nsOpen} onClose={() => setNsOpen(false)} />
        <UnitsModal isOpen={unitsOpen} onClose={() => setUnitsOpen(false)} />
      </IonContent>
    </IonPage>
  );
}
