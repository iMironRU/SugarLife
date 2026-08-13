import { IonIcon } from '@ionic/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { pulse, flash, cloudOfflineOutline, syncOutline, timeOutline, phonePortraitOutline, gitNetworkOutline } from 'ionicons/icons';
import { useTab, setTab } from '@/app/nav';
import { useStore } from '@/sources/store';
import { toUnits, agoText, unitLabel, useUnit, fmt, daysHoursText } from '@/domain/units';
import { arrowChar, getCfg } from '@/sources/nightscout';
import { deviceAges } from '@/domain/treatmentStats';
import { useChanges } from '@/settings/changes';
import { useDeviceExtras, loadDeviceExtras } from '@/sources/deviceExtras';
import { syncToActiveScreen, сразу } from '@/app/panel';
import { связь, связьГлюкозы, источникПомпы, устройствоРоли, меткаСвязи, видКруга, черезЧтоСпорное, type Связь } from '@/domain/deviceState';
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

/* Метка связи у названия крыла.

   Четыре состояния — три знака и молчание. «Не знаю» рисуем именно ничем: старый
   мост состояния не присылает, и любая метка на его месте была бы утверждением,
   которого мы сделать не можем. Пустое место читается как «неизвестно» само.

   Ожидание — часики, те же, что в круге вместо стрелки: там они уже означают
   «источник ещё не отдаёт свежее», и вводить для того же смысла второй знак значит
   заставлять запоминать два. */
function ТочкаСвязи({ что }: { что: Связь }) {
  if (что === 'unknown') return null;
  const title = меткаСвязи[что] ?? undefined;
  if (что === 'wait') return <IonIcon className="hp-link-wait" icon={timeOutline} title={title} />;
  return <span className={'live-dot' + (что === 'off' ? ' is-off' : '')} title={title} />;
}

/* Верхняя панель — единый постоянный элемент над контентом на ВСЕХ экранах.

   Состояний у неё нет: разметка одна и та же всегда, а размеры выражены в CSS
   через --p — степень сворачивания 0…1, которую пишет прокрутка (app/panel.ts).
   Поэтому здесь нет ни классов режима, ни замеров высоты: панель не участвует в
   прокрутке ни одним React-рендером. */
export default function HeroPanel() {
  const { data, live, status } = useStore();
  const снимок = useSnapshot(); // снимок движка — единственная правда о состоянии
  const m = снимок?.monitor ?? null; // монитор из моста (контракт)
  useUnit(); // перерисовка при смене единиц
  const tab = useTab();
  const extras = useDeviceExtras();
  const changes = useChanges();
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
  useLayoutEffect(() => { сразу(() => syncToActiveScreen(tab)); }, [tab]);

  // панель — владелец загрузки расширенных данных (датчик/резервуар/расход)
  useEffect(() => {
    loadDeviceExtras(true); // при открытии — сразу, дальше по внутренним срокам
    const id = window.setInterval(() => loadDeviceExtras(), 5 * 60e3);
    return () => window.clearInterval(id);
  }, [cfg?.url, cfg?.enabled]);

  const latest = data?.latest || null;
  const dev = data?.device || null;

  /* Возраст показания — из монитора моста, а не из стора.

     Число в круге мы уже берём у моста, а «сколько минут назад» считали по стору.
     Пока мост — это шим над тем же Nightscout, разницы нет. Но с нативным ядром
     источник глюкозы может быть другим (сенсор напрямую), и получилась бы пара
     «свежая цифра · пятнадцать минут назад» из двух разных источников. Для экрана,
     по которому решают, колоть ли, это недопустимо.
     Контракт 1.7 отдаёт latestAtMs ровно для этого; фолбэк на стор — на случай
     старого моста, который поля ещё не присылает. */
  const latestAt = m?.latestAtMs ?? latest?.t ?? null;

  // Головное значение и тренд — из моста (контракт); фолбэк на стор до первого снимка.
  // m.glucose — «сырая» строка движка (может включать единицу, напр. "6.1 mmol/L" у
  // нативного скелета) — для отображения в круге используем короткое число из glucoseMmol,
  // единицу показывает соседний .hp-unit.
  const glucose = m ? (m.glucoseMmol != null ? toUnits(m.glucoseMmol) : m.glucose) : latest ? toUnits(latest.mmol) : DASH;
  const arrow = m ? (TREND_CHAR[m.trend] ?? '') : latest ? arrowChar(latest.dir) : '';
  const ago = latestAt != null ? agoText(latestAt) : DASH;
  const minsAgo = latestAt != null ? Math.round((Date.now() - latestAt) / 60000) : null;
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
  const readingAge = latestAt != null ? agoText(latestAt).replace(' назад', '') : null;
  /* Живость — тоже из монитора, когда он её присылает: у ядра «живой» значит «основной
     источник отдаёт свежее», а у стора — «сокет подключён». Второе слабее: сокет может
     висеть подключённым и молчать. */
  const liveNow = m?.live ?? live;
  /* Источник ещё не отдаёт свежее: подключается, прогревается («связь есть, показаний
     ещё нет») или отстаёт. Это состояние появилось в контракте 1.7 — до него
     подключённый, но молчащий сенсор выглядел как обычный, и человек ждал цифру,
     которой неоткуда взяться. */
  const acquiring = m?.status === 'Acquiring' || m?.status === 'Connecting' || m?.status === 'Delayed';

  /* Что показывать в круге (SugarLifeCore#27).

     С железа: при подключении сенсора цифры в круге «бегут» — это догрузка истории,
     а читается как живая глюкоза. Круг — самая доверенная цифра в приложении, по ней
     решают, колоть ли; он не имеет права показывать то, чем нельзя пользоваться.

     Отсюда правило: число в круге бывает ТОЛЬКО у подтверждённо свежих данных.

     • ждём (Connecting/Acquiring) — часиков достаточно, числа нет вовсе. Приглушать
       здесь нечего: свежего показания ещё не было ни одного, а показать историческое
       и есть та самая ошибка.
     • отстало (Delayed) — число было, и оно остаётся, но приглушённым и с возрастом:
       спрятать последнее известное значение тоже нечестно, человеку важно знать, от
       чего он ушёл, — важно лишь, чтобы оно не выглядело текущим.
     • нет связи — прочерк.

     Ничего не анимируем. «Показать один раз, а не листать» у нас выполняется само:
     число просто перерисовывается новым значением, промежуточных кадров нет. */
  const круг = видКруга(снимок);
  const кругЖдёт = круг === 'ждём';
  const кругОтстал = круг === 'отстало';
  const syncState = !online ? 'offline'
    : (m?.status === 'Delayed' || status === 'stale' || status === 'error') ? 'stale'
    : liveNow ? 'live'
    : 'poll';
  const syncMain = syncState === 'offline' ? 'нет сети'
    : syncState === 'stale' ? 'нет связи'
    /* Живой поток — называем ИСТОЧНИК, если мост его знает: с нативным ядром их
       становится несколько (сенсор напрямую, Nightscout, облако производителя), и
       «реальное время» перестаёт отвечать на вопрос «откуда это число». Сердечко
       рядом и так говорит, что поток живой. */
    : syncState === 'live' ? (m?.source || 'реальное время')
    : data ? 'обновлено ' + agoText(data.updatedAt)
    : 'нет данных';
  const syncWarn = syncState === 'offline' || syncState === 'stale';

  /* Состояние связи обоих крыльев — из снимка движка, и только из него
     (SugarLifeCore#19). Раньше зелёная точка у «НМГ» горела от сокета стора, а у
     «Помпы» состояния не было вовсе: экран устройств говорил «на связи», главный
     экран об этом молчал, и человек получал два разных ответа на один вопрос.

     Стор остался источником данных — резервуар, история, события; но не источником
     того, работает ли связь сейчас. Правило одно на всё приложение, в
     domain/deviceState.ts, и та же функция читает карточку устройства. */
  const связьНмг = связьГлюкозы(снимок);
  const связьПомпы = связь(источникПомпы(снимок));
  /* Через что живёт крыло — но только когда путей несколько (SugarLifeCore#34).
     Именно здесь человек читал «Помпа на связи» и шёл искать поломку в мосте, хотя
     состояние всё это время приходило из облака. */
  const каналНмг = черезЧтоСпорное(устройствоРоли(снимок, 'sensor'));
  const каналПомпы = черезЧтоСпорное(устройствоРоли(снимок, 'pump'));

  // датчик (день N) — слева; запас инсулина (≈N дн) — справа
  const ages = deviceAges(extras.events, changes);
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
              <ТочкаСвязи что={связьНмг} />
              {каналНмг && <span className="hp-chan">{каналНмг}</span>}
            </span>
            <span className="hp-sub">{nmgSub}{staleSensor && <IonIcon className="hp-stale" icon={timeOutline} />}</span>
            <span className="hp-val">{nmgVal}</span>
          </button>

          <div className="hp-gap" />

          <button className="hp-wing hp-wing-r" onClick={() => setTab(3)}>
            <span className="hp-ico"><IonIcon icon={flash} /></span>
            <span className="hp-head">
              <span className="hp-name">Помпа</span>
              <ТочкаСвязи что={связьПомпы} />
              {каналПомпы && <span className="hp-chan">{каналПомпы}</span>}
            </span>
            {/* «Цикл вкл / Пауза» — это режим подачи, а не связь: помпа может стоять
                на паузе, будучи на связи, и молчать, будучи в замкнутом цикле. Два
                разных факта, поэтому две разные метки, а не одна на двоих. */}
            <span className="hp-sub">{pumpStatus}</span>
            <span className="hp-val">{reservoir}</span>
            <span className="hp-sub">{resSub2}{staleDays && <IonIcon className="hp-stale" icon={timeOutline} />}</span>
          </button>
        </div>

        <button className="hp-circle" onClick={() => setTab(1)} aria-label="Глюкоза">
          <CircleSparkline entries={data?.entries || []} />
          <span className="hp-circle-inner">
            <span className="hp-circle-val">
              {/* Пока ждём первого свежего — числа нет. Показать вместо него
                  историческое значило бы выдать догрузку истории за живой сахар. */}
              {!кругЖдёт && <span className={'hp-value' + (кругОтстал ? ' is-stale' : '')}>{glucose}</span>}
              {/* Часики вместо стрелки, пока источник не отдаёт свежее. Тренд в этот
                  момент относится к старому показанию, и рисовать его как текущий —
                  то же враньё, что и ноль вместо «неизвестно»: стрелка «вверх» на
                  получасовой давности цифре читается как «растёт прямо сейчас». */}
              {acquiring
                ? <IonIcon className={'hp-arrow hp-wait' + (кругЖдёт ? ' hp-wait-big' : '')} icon={timeOutline} />
                : arrow && <span className="hp-arrow">{arrow}</span>}
            </span>
            {/* Единица без числа — подпись к пустому месту, поэтому её тоже нет. */}
            {!кругЖдёт && <span className="hp-unit">{unitLabel()}</span>}
            <span className={'hp-iob' + (ai.known ? '' : ' is-unknown')} title={ai.reason ?? undefined}>{iobText}</span>
            {/* Возраст показания — единственная строка, которая при ожидании говорит
                по делу: «догоняю» отвечает на вопрос «почему пусто», а «5 мин назад»
                на него не отвечает, потому что показания ещё не было. */}
            <span className="hp-ago">{кругЖдёт ? 'догоняю…' : ago}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
