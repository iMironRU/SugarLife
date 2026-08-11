import { IonIcon, IonSpinner } from '@ionic/react';
import { useEffect, useState } from 'react';
import { pulse, flash, moon, cloudOfflineOutline, syncOutline, timeOutline, phonePortraitOutline, gitNetworkOutline } from 'ionicons/icons';
import { useTab, setTab } from '../data/nav';
import { useStore } from '../data/store';
import { toUnits, agoText, unitLabel, useUnit, fmt } from '../data/units';
import { arrowChar, getCfg } from '../data/nightscout';
import { deviceAges } from '../data/treatmentStats';
import { useDeviceExtras, loadDeviceExtras } from '../data/deviceExtras';
import { usePanelScrolled, setPanelScrolled } from '../data/panel';
import { useSnapshot } from '../data/bridge';
import { useTheme } from '../theme/useTheme';
import CircleSparkline from './CircleSparkline';

const DASH = '—';

// Тренд из контракта → символ стрелки
const TREND_CHAR: Record<string, string> = {
  RisingRapidly: '⇈', Rising: '↑', RisingSlowly: '↗', Stable: '→',
  FallingSlowly: '↘', Falling: '↓', FallingRapidly: '⇊',
};

// Короткий статус помпы для крыла
function shortStatus(s?: string | null): string {
  if (!s) return DASH;
  const l = s.toLowerCase();
  if (l.includes('приостан') || l.includes('пауза') || l.includes('suspend') || l.includes('stop')) return 'Пауза';
  if (l.includes('замкнут') || l.includes('closed')) return 'Цикл вкл';
  if (l.includes('открыт') || l.includes('open')) return 'Цикл выкл';
  return s;
}
const fmtDays = (d: number) => (d < 10 ? d.toFixed(1).replace('.', ',') : String(Math.round(d)));
const battColor = (p: number) => (p <= 20 ? 'var(--c-danger)' : p <= 50 ? 'var(--c-carb)' : 'var(--c-glu)');

/* Верхняя панель — единый постоянный элемент над контентом на ВСЕХ экранах.
   Три состояния плавно перетекают друг в друга (переход 0.22s):
   • full    — на «Сегодня»: большой круг, подписи-детали, строка синхронизации;
   • compact — на прочих экранах: панель сжата;
   • line    — прочие экраны при прокрутке: тонкая строка. */
export default function HeroPanel() {
  const { data, live, status } = useStore();
  const m = useSnapshot()?.monitor ?? null; // монитор из моста (контракт)
  const { toggle } = useTheme();
  useUnit(); // перерисовка при смене единиц
  const tab = useTab();
  const scrolled = usePanelScrolled();
  const extras = useDeviceExtras();
  const cfg = getCfg();

  // онлайн/офлайн — чтобы честно показать «нет сети»
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const full = tab === 2; // «Сегодня»
  const line = !full && scrolled;
  const mode = full ? 'is-full' : line ? 'is-line' : 'is-compact';

  // при переходе на другой экран панель разворачивается заново (сброс прокрутки)
  useEffect(() => { setPanelScrolled(false); }, [tab]);

  // панель — владелец загрузки расширенных данных (датчик/резервуар/расход)
  useEffect(() => {
    loadDeviceExtras();
    const id = window.setInterval(loadDeviceExtras, 120000);
    return () => window.clearInterval(id);
  }, [cfg?.url, cfg?.enabled]);

  const latest = data?.latest || null;
  const dev = data?.device || null;

  // Головное значение и тренд — из моста (контракт); фолбэк на стор до первого снимка.
  const glucose = m ? m.glucose : latest ? toUnits(latest.mmol) : DASH;
  const arrow = m ? (TREND_CHAR[m.trend] ?? '') : latest ? arrowChar(latest.dir) : '';
  // Возраст — по НАСТОЯЩЕМУ времени показания из моста (едино для любого источника), фолбэк на стор.
  const ago = m?.latestAtMs ? agoText(m.latestAtMs) : latest ? agoText(latest.t) : DASH;
  // Единый статус источника → что показать в кружке.
  const srcStatus = m?.status;
  const syncing = srcStatus === 'Connecting' || srcStatus === 'Acquiring';
  const delayed = srcStatus === 'Delayed';
  // Откуда текущее показание (сенсор/Nightscout) — короткой меткой под значением.
  const srcLabel = m?.source ? (m.source.includes('Nightscout') ? 'Nightscout' : m.source) : null;
  const minsAgo = latest ? Math.round((Date.now() - latest.t) / 60000) : null;
  const fresh = minsAgo == null ? DASH : minsAgo < 1 ? 'сейчас' : minsAgo + ' мин';

  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : DASH;
  const pumpStatus = shortStatus(dev?.status);
  const iob = dev?.iob != null ? fmt(dev.iob) : null; // активный инсулин — в круг

  // Полоса зарядов устройств над панелью — расширяемо: помпа, телефон-аплоадер, мост
  // (OrangeLink/RileyLink, pump.extended.OrangeLinkBattery от AAPS). Показываем только
  // то, что реально известно, без пустых иконок.
  const batteries: { id: string; icon: string; value: number | null }[] = [
    { id: 'pump', icon: flash, value: dev?.pumpBattery ?? null },
    { id: 'phone', icon: phonePortraitOutline, value: dev?.uploaderBattery ?? null },
    { id: 'mount', icon: gitNetworkOutline, value: dev?.mountBattery ?? null },
  ].filter((b) => b.value != null);

  // строка синхронизации: слева — как мы получаем (нами), справа — возраст
  // последнего значения в Nightscout, чтобы видеть задержку. + офлайн.
  // Возраст в верхней строке — по НАСТОЯЩЕМУ времени показания из движка (едино для сенсора/NS), фолбэк на стор.
  const readingAge = m?.latestAtMs ? agoText(m.latestAtMs) : latest ? agoText(latest.t) : null;
  const syncState = !online ? 'offline'
    : (status === 'stale' || status === 'error') ? 'stale'
    : live ? 'live'
    : 'poll';
  const syncMain = syncState === 'offline' ? 'нет сети'
    : syncState === 'stale' ? 'нет связи'
    : syncState === 'live' ? 'реальное время'
    : data ? 'обновлено ' + agoText(data.updatedAt)
    : 'нет данных';
  const syncWarn = syncState === 'offline' || syncState === 'stale';

  // датчик (день N) — слева; запас инсулина (≈N дн) — справа
  const ages = deviceAges(extras.events);
  const sensorDay = ages.sensor ? ages.sensor.days + 1 : null;
  const nmgSub = sensorDay != null ? 'датчик' : 'обновлено';
  const nmgVal = sensorDay != null ? 'день ' + sensorDay : fresh;
  const daysLeft = dev?.reservoir != null && extras.tdd ? dev.reservoir / extras.tdd : null;
  const resSub2 = daysLeft != null ? '≈ ' + fmtDays(daysLeft) + ' дн' : 'резервуар';
  // часики на значениях из кеша, пока идёт свежая загрузка (текст не подменяем)
  const staleSensor = extras.stale && sensorDay != null;
  const staleDays = extras.stale && daysLeft != null;

  return (
    <div className={'hero-panel ' + mode}>
      {full && (
        <div className="hp-sync">
          <span className={'hp-synctext' + (syncWarn ? ' warn' : '')}>
            {syncState === 'live'
              ? <span className="heart">♥</span>
              : <IonIcon className="sync-ico" icon={syncState === 'poll' ? syncOutline : cloudOfflineOutline} />}
            <span>{syncMain}</span>
            {readingAge && <span className="sync-reading">· значение {readingAge}</span>}
          </span>
          <button className="theme-btn" onClick={toggle} aria-label="Тема"><IonIcon icon={moon} /></button>
        </div>
      )}

      {batteries.length > 0 && (
        <div className="hp-batteries">
          {batteries.map((b) => (
            <span key={b.id} className="hp-batt-item" style={{ color: battColor(b.value as number) }}>
              <IonIcon icon={b.icon} />{b.value}%
            </span>
          ))}
        </div>
      )}

      <div className="hp-row">
        <div className="hp-rect">
          <button className="hp-wing hp-wing-l" onClick={() => setTab(1)}>
            <span className="hp-ico"><IonIcon icon={pulse} /></span>
            <span className="hp-head">
              <span className="hp-name">НМГ</span>
              {live && <span className="live-dot" title="реальное время" />}
            </span>
            <span className="hp-sub">{nmgSub}{staleSensor && <IonIcon className="hp-stale" icon={timeOutline} />}</span>
            <span className="hp-val">{nmgVal}</span>
          </button>

          <div className="hp-gap" />

          <button className="hp-wing hp-wing-r" onClick={() => setTab(3)}>
            <span className="hp-ico"><IonIcon icon={flash} /></span>
            <span className="hp-name">Помпа</span>
            <span className="hp-sub">{pumpStatus}</span>
            <span className="hp-val">{reservoir}</span>
            <span className="hp-sub">{resSub2}{staleDays && <IonIcon className="hp-stale" icon={timeOutline} />}</span>
          </button>
        </div>

        <button className="hp-circle" onClick={() => setTab(1)} aria-label="Глюкоза">
          <CircleSparkline entries={data?.entries || []} />
          <span className="hp-circle-inner">
            <span className="hp-circle-val">
              <span className="hp-value">
                {/* Пока источник не «на связи со свежим» (Connecting/Acquiring) — часики, а НЕ прыгающее
                    недостоверное число: прогон истории прячем за загрузчиком, число даём только когда актуально. */}
                {syncing ? <IonSpinner name="crescent" className="hp-loading" /> : glucose}
              </span>
              {arrow && !syncing && <span className="hp-arrow">{arrow}</span>}
            </span>
            <span className="hp-unit">{unitLabel()}</span>
            {srcLabel && !syncing && <span className="hp-src">{srcLabel}</span>}
            {iob != null && <span className="hp-iob">инс. {iob} ед</span>}
            <span className={'hp-ago' + (delayed ? ' warn' : '')}>
              {srcStatus === 'Connecting' ? 'подключение…'
                : srcStatus === 'Acquiring' ? 'загрузка истории…'
                : delayed ? '⚠ задержка · ' + ago
                : ago}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
