import { IonPage, IonContent, IonIcon } from '@ionic/react';
import {
  personCircle, chevronForward, downloadOutline,
  optionsOutline, nutritionOutline, ellipse, sunny, moon, refreshOutline,
  hardwareChipOutline, cloudOutline, repeat,
} from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore } from '../data/store';
import { resetLocalData } from '../data/reset';
import { useClouds } from '../data/clouds';
import { stats } from '../data/agp';
import { detectTherapy, therapyLabel } from '../data/therapy';
import { fmt, toUnits, unitLabel, useUnit, carbUnitLabel, useCarbUnit } from '../data/units';
import { countEntries } from '../data/db';
import { exportGlucoseCsv } from '../data/export';
import { useTheme } from '../theme/useTheme';
import { reportContentScroll } from '../data/panel';
import { APP_VERSION, APP_BUILD, isNative, platform, checkOtaUpdate, checkNativeUpdate, openApkDownload } from '../data/appUpdate';
import { useStack } from '../data/stackCtx';
import { useUpdateState, checkNow, applyUpdate, consumeJustUpdated } from '../data/swUpdate';
import { useLoopProfile, LOOP_MODES } from '../data/loopProfile';
import Row from '../components/Row';
import UnitsModal from '../components/UnitsModal';
import CarbUnitsModal from '../components/CarbUnitsModal';
import DevicesScreen from '../components/DevicesScreen';
import ServicesScreen from '../components/ServicesScreen';
import LoopSetupScreen from '../components/LoopSetupScreen';

const DASH = '—';

export default function Profile() {
  const { status, data } = useStore();
  const { theme, setTheme } = useTheme();
  const unit = useUnit();
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [carbUnitsOpen, setCarbUnitsOpen] = useState(false);
  const carbUnit = useCarbUnit();
  const { push, pop } = useStack();
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);

  useEffect(() => { countEntries().then(setCount).catch(() => setCount(null)); }, [data]);

  const clouds = useClouds();
  const enabledClouds = clouds.filter((c) => c.enabled);
  const cloudsValue = clouds.length === 0 ? 'нет облаков'
    : enabledClouds.length === 0 ? 'выкл'
    : status === 'ok' ? (enabledClouds.length > 1 ? `${enabledClouds.length} подключено` : 'подключено')
    : status === 'loading' ? 'подключение…'
    : (status === 'error' || status === 'stale') ? 'нет связи' : DASH;

  const reset = () => {
    if (!window.confirm('Сбросить настройки? С этого устройства будут удалены облака, записанные устройства и локальная история глюкозы.')) return;
    resetLocalData();
    location.reload();
  };

  // Нативное обновление (OTA + APK). Веб живёт отдельно — в data/swUpdate.ts.
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

  /* Состояние обновления веб-версии. Четыре ответа на три вопроса, которые раньше
     оставались без ответа: есть ли обновление, применилось ли, нужна ли перезагрузка. */
  const upd = useUpdateState();
  const [justUpdated, setJustUpdated] = useState(() => consumeJustUpdated()); // разово после перезагрузки
  // «Обновлено до X» держится, пока человек не начал новую проверку — иначе оно
  // висело бы всю сессию и перекрывало «Проверяю…» и ошибки
  useEffect(() => {
    if (upd.status === 'checking' || upd.status === 'available') setJustUpdated(false);
  }, [upd.status]);
  const agoMin = upd.checkedAt ? Math.round((Date.now() - upd.checkedAt) / 60000) : null;
  const webUpdateNote = justUpdated ? `Обновлено до сборки ${APP_BUILD}.`
    : upd.status === 'available' ? 'Новая версия скачана. Применится после перезагрузки.'
    : upd.status === 'checking' ? 'Проверяю…'
    : upd.status === 'error' ? 'Не удалось проверить — похоже, нет сети.'
    : upd.status === 'unsupported' ? 'Автообновление недоступно — обновите страницу вручную.'
    : upd.status === 'current' ? `Актуально · проверено ${agoMin != null && agoMin > 0 ? agoMin + ' мин назад' : 'только что'}`
    : 'Проверяю…';

  const loop = useLoopProfile();
  const loopMode = LOOP_MODES.find((m) => m.id === loop.mode);
  const loopSub = loop.savedAt
    ? `${loopMode?.code} · ${loopMode?.name.toLowerCase()}`
    : 'не настроен';

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

          {/* настройки */}
          <div className="section-label sec">Настройки</div>
          <div className="list">
            <Row icon={optionsOutline} title="Единицы глюкозы" value={unitLabel(unit)} onClick={() => setUnitsOpen(true)} />
            <Row icon={nutritionOutline} title="Единицы еды" value={carbUnitLabel(carbUnit)} onClick={() => setCarbUnitsOpen(true)} />
            <Row icon={downloadOutline} title="Экспорт глюкозы в CSV" chevron={false} onClick={doExport} disabled={exporting}
              value={exporting ? 'выгрузка…' : count != null ? `${count} зап.` : DASH} />
          </div>
          {exportMsg && <div className="metric-note" style={{ marginTop: 8 }}>{exportMsg}</div>}

          <div className="metric-note" style={{ marginTop: 14 }}>
            Данные хранятся только на этом устройстве, без облака и аккаунта.
          </div>

          {/* устройства (ЧТО) — отдельный полноэкранный раздел, не инлайн-список
              (см. docs/CONNECT-UX.md §10 «Карта интерфейса»: Профиль → Устройства) */}
          <div className="section-label sec">Устройства</div>
          <div className="list">
            <Row icon={hardwareChipOutline} title="Помпа, сенсоры, глюкометр, петля"
              onClick={() => push(<DevicesScreen onClose={pop} />)} />
          </div>

          {/* способы / сервисы (КАК): облако — такой же транспорт, как мост, только со своими
              настройками (URL/токен) и статусом (доступность/связь) вместо сигнала/батареи */}
          <div className="section-label sec">Сервисы</div>
          <div className="list">
            <Row icon={cloudOutline} title="Облака" value={cloudsValue}
              onClick={() => push(<ServicesScreen onClose={pop} />)} />
          </div>

          {/* алгоритм: профиль петли. Только настройка — подача не включается (решение 0004) */}
          <div className="section-label sec">Алгоритм</div>
          <div className="list">
            <button className="list-row" onClick={() => push(<LoopSetupScreen onClose={pop} />)}>
              <IonIcon icon={repeat} className="list-ico" />
              <span className="pick-main">
                <span className="list-title">Профиль петли</span>
                <span className="pick-sub">{loopSub}</span>
              </span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
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
            ) : isNative ? (
              <button className="about-update" onClick={doUpdate} disabled={updating}>
                <IonIcon icon={refreshOutline} className={updating ? 'spin' : ''} />
                {updating ? 'Проверяю…' : 'Обновиться'}
              </button>
            ) : upd.status === 'available' ? (
              /* кнопка честно предупреждает, что будет перезагрузка */
              <button className="about-update accent" onClick={applyUpdate} disabled={upd.applying}>
                <IonIcon icon={refreshOutline} className={upd.applying ? 'spin' : ''} />
                {upd.applying ? 'Обновляю…' : 'Обновить и перезагрузить'}
              </button>
            ) : (
              <button className="about-update" onClick={checkNow} disabled={upd.status === 'checking'}>
                <IonIcon icon={refreshOutline} className={upd.status === 'checking' ? 'spin' : ''} />
                {upd.status === 'checking' ? 'Проверяю…' : 'Проверить'}
              </button>
            )}
          </div>
          {/* состояние обновления — текстом, а не догадками после нажатия */}
          {!isNative && <div className="metric-note" style={{ marginTop: 8 }}>{webUpdateNote}</div>}
          {isNative && updateMsg && <div className="metric-note" style={{ marginTop: 8 }}>{updateMsg}</div>}

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

          <button className="logout" onClick={reset}>Сбросить настройки</button>
        </div>

        <UnitsModal isOpen={unitsOpen} onClose={() => setUnitsOpen(false)} />
        <CarbUnitsModal isOpen={carbUnitsOpen} onClose={() => setCarbUnitsOpen(false)} />
      </IonContent>
    </IonPage>
  );
}
