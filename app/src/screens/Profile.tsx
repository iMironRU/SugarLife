import { IonPage, IonContent, IonIcon, IonToggle } from '@ionic/react';
import { DevicesSection, DiagnosticsSection, LoopSetupSection, ServicesSection } from '@/sections/lazy';
import {
  personCircle, downloadOutline,
  optionsOutline, nutritionOutline, ellipse, sunny, moon, refreshOutline,
  hardwareChipOutline, cloudOutline, repeat, sparklesOutline, documentTextOutline,
} from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore } from '@/sources/store';
import { resetLocalData } from '@/settings/reset';
import { useClouds } from '@/sources/clouds';
import { stats } from '@/domain/agp';
import { detectTherapy, therapyLabel } from '@/domain/therapy';
import { fmt, toUnits, unitLabel, useUnit, carbUnitLabel, useCarbUnit } from '@/domain/units';
import { countEntries } from '@/sources/db';
import { exportGlucoseCsv } from '@/platform/export';
import { useTheme } from '../theme/useTheme';
import { reportContentScroll } from '@/app/panel';
import { APP_VERSION, APP_BUILD, isNative, platform, checkOtaUpdate, checkNativeUpdate, openApkDownload } from '@/platform/appUpdate';
import { useStack } from '@/app/stackCtx';
import { useUpdateState, checkNow, applyUpdate, consumeJustUpdated } from '@/platform/swUpdate';
import { useLoopProfile, LOOP_MODES } from '@/settings/loopProfile';
import { useDeviceConfig, deviceStatus } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import Row from '@/ui/Row';
import { useAnalyticsOn, setAnalyticsOn } from '@/settings/analytics';
import UnitsModal from '@/sheets/UnitsModal';
import CarbUnitsModal from '@/sheets/CarbUnitsModal';

const DASH = '—';

export default function Profile() {
  const { status, data } = useStore();
  const { theme, setTheme } = useTheme();
  const unit = useUnit();
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [carbUnitsOpen, setCarbUnitsOpen] = useState(false);
  const carbUnit = useCarbUnit();
  const { push, pop } = useStack();
  const analyticsOn = useAnalyticsOn();
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

  /* Что записано в устройствах — коротко, для строки-входа. Названия моделей, а не
     «настроено»: человек проверяет глазами свою помпу и свой сенсор, а слово
     «настроено» одинаково выглядит и когда всё верно, и когда записана не та модель. */
  const devCfg = useDeviceConfig();
  const устройства = [pumpById(devCfg.pumpId)?.model, sensorById(devCfg.sensorId)?.name]
    .filter(Boolean).join(' · ') || 'ничего не записано';
  /* Справа — только то, что требует действия. Строка молчит, пока всё в порядке:
     постоянная надпись «настроено» перестаёт читаться, и «нужен мост» рядом с ней
     пропадёт вместе со всеми остальными. */
  const нуженМост = deviceStatus('pump', devCfg) === 'needsBridge'
    || deviceStatus('sensor', devCfg) === 'needsBridge';

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
      <IonContent fullscreen forceOverscroll scrollEvents onIonScroll={reportContentScroll}>
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

          {/* Порядок разделов — по тому, зачем сюда заходят, а не по тому, что важнее
              звучит. Приходят посмотреть: на связи ли облако, что вообще подключено,
              какая петля настроена. Единицы глюкозы меняют один раз в жизни, но они
              стояли первыми и отодвигали вниз всё, ради чего экран открывают.

              Поэтому сверху то, что работает, ниже — настройки. Диагностика, версия и
              оформление в конце: туда идут по конкретному поводу и заранее знают, что
              ищут.

              Заголовков над этими тремя строками нет намеренно. Раньше их было три —
              «Устройства», «Сервисы», «Алгоритм», — и каждый стоял над единственной
              строкой, повторяя её же название. Заголовок нужен, когда он собирает
              разнородное под общим смыслом; над одной строкой он только отнимает
              высоту и разбивает на три куска то, что глазом читается как один список
              входов.

              Своего имени у этой тройки нет и не придумывается: устройства — железо,
              облака — транспорт, профиль петли — правила счёта. Общее у них только
              «моё, работающее», а заголовок, который приходится сочинять, обычно
              означает, что группы нет. Строки называют себя сами.

              Границу ЧТО (устройства) и КАК (сервисы) из docs/CONNECT-UX.md §10 это не
              трогает: разделы разные, входы разные, рядом стоят только строки. */}
          <div className="list">
            {/* Подпись — то, что записано на самом деле. Заголовок перечисляет, что
                внутри раздела, и на вопрос «а что у меня подключено» не отвечал: за
                ответом надо было открывать. Самый быстрый взгляд — тот, ради которого
                никуда не переходят. */}
            <Row icon={hardwareChipOutline} title="Помпа, сенсоры, глюкометр, петля"
              sub={устройства} value={нуженМост ? 'нужен мост' : undefined}
              onClick={() => push(<DevicesSection onClose={pop} />)} />
            {/* облако — такой же транспорт, как мост, только со своими настройками
                (URL/токен) и статусом (доступность/связь) вместо сигнала и батареи */}
            <Row icon={cloudOutline} title="Облака" sub="Nightscout и другие источники"
              value={cloudsValue}
              onClick={() => push(<ServicesSection onClose={pop} />)} />
            {/* профиль петли: только настройка — подача не включается (решение 0004) */}
            <Row icon={repeat} title="Профиль петли" sub={loopSub}
              onClick={() => push(<LoopSetupSection onClose={pop} />)} />
          </div>

          {/* настройки */}
          <div className="section-label sec">Настройки</div>
          <div className="list">
            <Row icon={optionsOutline} title="Единицы глюкозы" value={unitLabel(unit)} onClick={() => setUnitsOpen(true)} />
            <Row icon={nutritionOutline} title="Единицы еды" value={carbUnitLabel(carbUnit)} onClick={() => setCarbUnitsOpen(true)} />
            <Row icon={sparklesOutline} title="Выводить аналитику"
              sub="разбор данных на «Сегодня» и отдельным экраном"
              right={<IonToggle checked={analyticsOn} onIonChange={(e) => setAnalyticsOn(e.detail.checked)} />} />
            <Row icon={downloadOutline} title="Экспорт глюкозы в CSV" chevron={false} onClick={doExport} disabled={exporting}
              value={exporting ? 'выгрузка…' : count != null ? `${count} зап.` : DASH} />
          </div>
          {exportMsg && <div className="metric-note" style={{ marginTop: 8 }}>{exportMsg}</div>}

          {/* Про хранение — рядом с экспортом: вопрос «а где вообще лежат мои данные»
              возникает именно здесь. */}
          <div className="metric-note" style={{ marginTop: 14 }}>
            Данные хранятся только на этом устройстве, без облака и аккаунта.
          </div>

          {/* Диагностика — в глубине, а не на виду: человеку с диабетом она нужна раз в
              полгода, когда что-то не работает, и место на главном занимать не должна.
              Но найти её надо уметь быстро, поэтому рядом с «о приложении», где и так
              ищут версию и обновление (SugarLifeCore#17). */}
          <div className="section-label sec">Диагностика</div>
          <div className="list">
            <Row icon={documentTextOutline} title="Логи работы"
              sub="уровень подробности, запись в файл, выгрузка"
              onClick={() => push(<DiagnosticsSection onClose={pop} />)} />
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
