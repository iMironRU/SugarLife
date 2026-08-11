import { IonIcon } from '@ionic/react';
import { useEffect, useState } from 'react';
import { pulse, flash, cloudOfflineOutline, syncOutline, timeOutline, phonePortraitOutline, gitNetworkOutline } from 'ionicons/icons';
import { useTab, setTab } from '@/app/nav';
import { useStore } from '@/sources/store';
import { toUnits, agoText, unitLabel, useUnit, fmt, daysHoursText } from '@/domain/units';
import { arrowChar, getCfg } from '@/sources/nightscout';
import { deviceAges } from '@/domain/treatmentStats';
import { useDeviceExtras, loadDeviceExtras } from '@/sources/deviceExtras';
import { syncToActiveScreen } from '@/app/panel';
import { activeInsulin } from '@/domain/loopValue';
import { useSnapshot } from '@/sources/bridge';
import CircleSparkline from '@/charts/CircleSparkline';

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
const battColor = (p: number) => (p <= 20 ? 'var(--c-danger)' : p <= 50 ? 'var(--c-carb)' : 'var(--c-glu)');

/* Верхняя панель — единый постоянный элемент над контентом на ВСЕХ экранах.

   Состояний у неё нет: разметка одна и та же всегда, а размеры выражены в CSS
   через --p — степень сворачивания 0…1, которую пишет прокрутка (app/panel.ts).
   Поэтому здесь нет ни классов режима, ни замеров высоты: панель не участвует в
   прокрутке ни одним React-рендером. */
export default function HeroPanel() {
  const { data, live, status } = useStore();
  const m = useSnapshot()?.monitor ?? null; // монитор из моста (контракт)
  useUnit(); // перерисовка при смене единиц
  const tab = useTab();
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

  /* Все экраны равны: панель везде начинается развёрнутой и сворачивается за
     прокруткой. Переключились на вкладку, прокрутанную вниз, — панель встаёт в то
     же положение, в каком её там оставили (иначе она разворачивалась бы поверх
     содержимого, которое стоит на месте). */
  useEffect(() => { syncToActiveScreen(); }, [tab]);

  // панель — владелец загрузки расширенных данных (датчик/резервуар/расход)
  useEffect(() => {
    loadDeviceExtras(true); // при открытии — сразу, дальше по внутренним срокам
    const id = window.setInterval(() => loadDeviceExtras(), 5 * 60e3);
    return () => window.clearInterval(id);
  }, [cfg?.url, cfg?.enabled]);

  const latest = data?.latest || null;
  const dev = data?.device || null;

  // Головное значение и тренд — из моста (контракт); фолбэк на стор до первого снимка.
  // m.glucose — «сырая» строка движка (может включать единицу, напр. "6.1 mmol/L" у
  // нативного скелета) — для отображения в круге используем короткое число из glucoseMmol,
  // единицу показывает соседний .hp-unit.
  const glucose = m ? (m.glucoseMmol != null ? toUnits(m.glucoseMmol) : m.glucose) : latest ? toUnits(latest.mmol) : DASH;
  const arrow = m ? (TREND_CHAR[m.trend] ?? '') : latest ? arrowChar(latest.dir) : '';
  const ago = latest ? agoText(latest.t) : DASH;
  const minsAgo = latest ? Math.round((Date.now() - latest.t) / 60000) : null;
  const fresh = minsAgo == null ? DASH : minsAgo < 1 ? 'сейчас' : minsAgo + ' мин';

  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : DASH;
  const pumpStatus = shortStatus(dev?.status);
  /* Активный инсулин в круге. Раньше строка просто исчезала, когда цикл молчал, —
     и пустота читалась как «инсулина нет». Теперь она на месте всегда, а неизвестное
     показано прочерком и приглушённым цветом (см. domain/loopValue.ts). */
  const ai = activeInsulin(dev);
  const iobText = ai.known ? 'инс. ' + fmt(dev!.iob as number) + ' ед' : 'инс. ' + DASH;

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
  // Короткая форма: строка статуса теперь всегда в одну линию рядом с зарядами,
  // и «назад» в ней — лишние ~35px, из-за которых текст обрезался на узких экранах.
  const readingAge = latest ? agoText(latest.t).replace(' назад', '') : null;
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
  /* Без настроенного источника день датчика не показываем: события замены лежат
     в локальной истории и пережили бы отключение, а «день 8» рядом с прочерками
     читается как живое состояние. Дальше см. DataGate в NotConfigured.tsx. */
  const sensorDay = status !== 'off' && ages.sensor ? ages.sensor.days + 1 : null;
  const nmgSub = sensorDay != null ? 'датчик' : 'обновлено';
  const nmgVal = sensorDay != null ? 'день ' + sensorDay : fresh;
  const daysLeft = dev?.reservoir != null && extras.tdd ? dev.reservoir / extras.tdd : null;
  const resSub2 = daysLeft != null ? '≈ ' + daysHoursText(daysLeft) : 'резервуар';
  // часики на значениях из кеша, пока идёт свежая загрузка (текст не подменяем)
  const staleSensor = extras.stale && sensorDay != null;
  const staleDays = extras.stale && daysLeft != null;

  /* Высоту панели больше не меряют.

     Раньше здесь жили ResizeObserver, гашение переходов на кадр замера и запись
     двух переменных — --sl-panel-h и --sl-panel-rest. Всё это было следствием того,
     что высота получалась «сама собой» из трёх состояний и её приходилось узнавать
     задним числом. Теперь она задана формулой: покой = безопасная зона + 10 + строка
     статуса (20+10) + ряд 150, а сворачивание отнимает ровно 100px. Обе переменные
     считает CSS из --p (theme/parts/shell.css), и промахнуться там нечем. */

  return (
    <div className="hero-panel">
      {/* Статус связи + заряды — одним блоком. Он НЕ прячется при сворачивании панели:
          это то, что нужно видеть всегда. Разворот только меняет раскладку — две строки
          сходятся в одну (см. .hp-status). */}
      <div className="hp-status">
        <span className={'hp-synctext' + (syncWarn ? ' warn' : '')}>
          {syncState === 'live'
            ? <span className="heart">♥</span>
            : <IonIcon className="sync-ico" icon={syncState === 'poll' ? syncOutline : cloudOfflineOutline} />}
          <span>{syncMain}</span>
          {readingAge && <span className="sync-reading">· {readingAge}</span>}
        </span>
        {batteries.length > 0 && (
          <span className="hp-batteries">
            {batteries.map((b) => (
              <span key={b.id} className="hp-batt-item" style={{ color: battColor(b.value as number) }}>
                <IonIcon icon={b.icon} />{b.value}%
              </span>
            ))}
          </span>
        )}
      </div>

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
              <span className="hp-value">{glucose}</span>
              {arrow && <span className="hp-arrow">{arrow}</span>}
            </span>
            <span className="hp-unit">{unitLabel()}</span>
            <span className={'hp-iob' + (ai.known ? '' : ' is-unknown')} title={ai.reason ?? undefined}>{iobText}</span>
            <span className="hp-ago">{ago}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
