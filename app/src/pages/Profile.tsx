import { IonPage, IonContent, IonIcon } from '@ionic/react';
import {
  personCircle, chevronForward, downloadOutline,
  optionsOutline, nutritionOutline, ellipse, sunny, moon, refreshOutline,
  hardwareChipOutline, medkitOutline, repeat, speedometerOutline, cloudOutline,
} from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore } from '../data/store';
import { getCfg, setCfg } from '../data/nightscout';
import { stats } from '../data/agp';
import { detectTherapy, therapyLabel } from '../data/therapy';
import { fmt, toUnits, unitLabel, useUnit, carbUnitLabel, useCarbUnit } from '../data/units';
import { countEntries } from '../data/db';
import { exportGlucoseCsv } from '../data/export';
import { useTheme } from '../theme/useTheme';
import { reportContentScroll } from '../data/panel';
import { APP_VERSION, APP_BUILD, isNative, platform, checkWebUpdate, checkOtaUpdate, checkNativeUpdate, openApkDownload } from '../data/appUpdate';
import { useCloseOnLeave } from '../data/nav';
import NightscoutModal from '../components/NightscoutModal';
import UnitsModal from '../components/UnitsModal';
import CarbUnitsModal from '../components/CarbUnitsModal';
import DeviceSheet, { type DeviceCatKey } from '../components/DeviceSheet';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '../data/deviceConfig';

// «Устройства» (ЧТО) — реестр того, что у пользователя есть физически. Открывают общий
// каркас DeviceSheet (модель + вкладка «Мост» для радио-транспортов вроде OrangeLink/RileyLink).
// Облако/сервисы (Nightscout и т.п.) — это КАК, отдельный раздел «Способы / Сервисы» ниже
// (см. docs/CONNECT-UX.md §2b: устройство и способ подключения — независимые оси).
const DEVICES: { key: string; icon: string; title: string; sheet: DeviceCatKey }[] = [
  { key: 'sensor', icon: hardwareChipOutline, title: 'Сенсор (НМГ)', sheet: 'sensor' },
  { key: 'insulin', icon: medkitOutline, title: 'Ввод инсулина', sheet: 'pump' },
  { key: 'loop', icon: repeat, title: 'Петля', sheet: 'loop' },
  { key: 'meter', icon: speedometerOutline, title: 'Глюкометр', sheet: 'meter' },
];

const DASH = '—';

export default function Profile() {
  const { status, data } = useStore();
  const { theme, setTheme } = useTheme();
  const unit = useUnit();
  const [nsOpen, setNsOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [carbUnitsOpen, setCarbUnitsOpen] = useState(false);
  const carbUnit = useCarbUnit();
  const [deviceCat, setDeviceCat] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  useCloseOnLeave(4, () => setNsOpen(false), () => setUnitsOpen(false), () => setCarbUnitsOpen(false), () => setDeviceCat(null)); // «Профиль» — закрыть модалки при уходе

  useEffect(() => { countEntries().then(setCount).catch(() => setCount(null)); }, [data]);

  const devCfg = useDeviceConfig();
  const tileLabel = (sheet: DeviceCatKey): string =>
    sheet === 'sensor' || sheet === 'pump' ? deviceStatusLabel(deviceStatus(sheet, devCfg)) : 'настроить';

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
    setApkUrl(null);

    // Нативка: сначала OTA (JS-бандл, лёгкий путь), потом APK (нативный код).
    if (isNative) {
      const ota = await checkOtaUpdate();
      if (ota === 'updated') return; // применилось → webview перезагрузится сам

      // Android: если по JS всё свежее (или OTA недоступен) — проверяем новый APK.
      if (platform === 'android') {
        const r = await checkNativeUpdate();
        setUpdating(false);
        if (r === 'error') {
          setUpdateMsg(ota === 'current' ? 'У вас последняя версия.' : 'Не удалось проверить обновление.');
          return;
        }
        if (r.hasUpdate && r.apkUrl) {
          setApkUrl(r.apkUrl);
          setUpdateMsg('Нужна новая сборка приложения' + (r.build ? ` (${r.build})` : '') + '.');
        } else {
          setUpdateMsg('У вас последняя версия.');
          window.setTimeout(() => setUpdateMsg(null), 4000);
        }
        return;
      }

      // iOS: APK-пути нет (только App Store), но OTA уже отработал выше.
      setUpdating(false);
      setUpdateMsg(ota === 'current' ? 'У вас последняя версия.' : 'Не удалось проверить обновление.');
      if (ota === 'current') window.setTimeout(() => setUpdateMsg(null), 4000);
      return;
    }

    // Веб/PWA — обновляем оболочку через service worker.
    const r = await checkWebUpdate();
    setUpdating(false);
    if (r === 'current') { setUpdateMsg('У вас последняя версия.'); window.setTimeout(() => setUpdateMsg(null), 4000); }
    else if (r === 'error') setUpdateMsg('Не удалось проверить обновление.');
    // 'updated' → приложение перезагрузится само
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
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
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

          {/* устройства (ЧТО): модель + вкладка «Мост» для радио-транспортов */}
          <div className="section-label sec">Устройства</div>
          <div className="list">
            {DEVICES.map((d) => (
              <button key={d.key} className="list-row" onClick={() => setDeviceCat(d.key)}>
                <IonIcon icon={d.icon} className="list-ico" />
                <span className="list-title">{d.title}</span>
                <span className="list-value">{tileLabel(d.sheet)}</span>
                <IonIcon icon={chevronForward} className="list-chev" />
              </button>
            ))}
          </div>

          {/* способы / сервисы (КАК): облако — такой же транспорт, как мост, только со своими
              настройками (URL/токен) и статусом (доступность/связь) вместо сигнала/батареи */}
          <div className="section-label sec">Способы / Сервисы</div>
          <div className="list">
            <button className="list-row" onClick={() => setNsOpen(true)}>
              <IonIcon icon={cloudOutline} className="list-ico" />
              <span className="list-title">Nightscout</span>
              <span className="list-value">{nsValue}</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
          </div>

          {/* настройки */}
          <div className="section-label sec">Настройки</div>
          <div className="list">
            <button className="list-row" onClick={() => setUnitsOpen(true)}>
              <IonIcon icon={optionsOutline} className="list-ico" />
              <span className="list-title">Единицы глюкозы</span>
              <span className="list-value">{unitLabel(unit)}</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
            <button className="list-row" onClick={() => setCarbUnitsOpen(true)}>
              <IonIcon icon={nutritionOutline} className="list-ico" />
              <span className="list-title">Единицы еды</span>
              <span className="list-value">{carbUnitLabel(carbUnit)}</span>
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
            {apkUrl ? (
              <button className="about-update accent" onClick={() => openApkDownload(apkUrl)}>
                <IonIcon icon={downloadOutline} />
                Скачать APK
              </button>
            ) : (
              <button className="about-update" onClick={doUpdate} disabled={updating}>
                <IonIcon icon={refreshOutline} className={updating ? 'spin' : ''} />
                {updating ? 'Проверяю…' : 'Обновиться'}
              </button>
            )}
          </div>
          {updateMsg && <div className="metric-note" style={{ marginTop: 8 }}>{updateMsg}</div>}

          <button className="logout" onClick={reset}>Сбросить настройки</button>
        </div>

        <NightscoutModal isOpen={nsOpen} onClose={() => setNsOpen(false)} />
        <UnitsModal isOpen={unitsOpen} onClose={() => setUnitsOpen(false)} />
        <CarbUnitsModal isOpen={carbUnitsOpen} onClose={() => setCarbUnitsOpen(false)} />
        {DEVICES.filter((d) => d.sheet).map((d) => (
          <DeviceSheet key={d.key} isOpen={deviceCat === d.key} onClose={() => setDeviceCat(null)} cat={d.sheet!} title={d.title} />
        ))}
      </IonContent>
    </IonPage>
  );
}
