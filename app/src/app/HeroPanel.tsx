import Иконка from '@/ui/Иконка';
import { сколькоНазад, дниЧасы } from '@/слова/время';
import { useEffect, useLayoutEffect, useState } from 'react';
import { pulse, flash, cloudOfflineOutline, syncOutline, timeOutline, phonePortraitOutline, gitNetworkOutline, warningOutline } from 'ionicons/icons';
import { useTab, setTab } from '@/app/nav';
import { useStore } from '@/sources/store';
import { toUnits, unitLabel, useUnit, fmt } from '@/domain/units';
import { getCfg } from '@/sources/nightscout';
import { deviceAges } from '@/domain/treatmentStats';
import { useChanges } from '@/settings/changes';
import { useDeviceExtras, loadDeviceExtras } from '@/sources/deviceExtras';
import { syncToActiveScreen, сразу } from '@/app/panel';
import { связь, связьГлюкозы, источникПомпы, устройствоРоли, видКруга, спорныйКанал, type Связь } from '@/domain/deviceState';
import { меткаСвязи, короткоКанал } from '@/слова/приборы';
import { СТРЕЛКА, направление } from '@/domain/trend';
import { предупредитьОСыром, МЕТКА_СЫРОГО, ПОЯСНЕНИЕ_СЫРОГО } from '@/domain/сырое';
import { useEntries } from '@/sources/db';
import { выбратьПоказание, ОТСТАВАНИЕ_МС } from '@/domain/latestGlucose';
import { activeInsulin } from '@/domain/loopValue';
import { useЧужаяПетля } from '@/показ/чужаяПетля';
import { useSnapshot } from '@/sources/bridge';
import { расходка } from '@/domain/supplies';
import CircleSparkline from '@/charts/CircleSparkline';

const DASH = '—';

// Тренд из контракта → символ стрелки
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
  if (что === 'wait') return <Иконка className="hp-link-wait" icon={timeOutline} title={title} />;
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
  /* Час истории — с запасом: направление считается по пятнадцати минутам, но точки
     приходят неровно, и на дырявом потоке окно должно быть из чего набрать. */
  const историяЧаса = useEntries(3600e3, { minRefreshMs: 20e3 });
  const dev = data?.device || null;

  /* Возраст показания — из монитора моста, а не из стора.

     Число в круге мы уже берём у моста, а «сколько минут назад» считали по стору.
     Пока мост — это шим над тем же Nightscout, разницы нет. Но с нативным ядром
     источник глюкозы может быть другим (сенсор напрямую), и получилась бы пара
     «свежая цифра · пятнадцать минут назад» из двух разных источников. Для экрана,
     по которому решают, колоть ли, это недопустимо.
     Контракт 1.7 отдаёт latestAtMs ровно для этого; фолбэк на стор — на случай
     старого моста, который поля ещё не присылает. */
  /* Свежайшее из двух, а не «всегда мост» (#326).

     С телефона пришло: в списке 9,1 за 00:21, в круге 8,6 и «10 минут назад». Оба
     числа честные, просто добытые разными путями одного источника: круг брал у моста,
     список — из нашей базы, и рассинхрон между ними ничем не ограничен.

     Брать всегда базу тоже нельзя: с нативным ядром источником может быть сенсор
     напрямую, и тогда мост знает то, чего в базе ещё нет. Правило в domain/latestGlucose. */
  const последнееБазы = историяЧаса.length
    ? { mmol: историяЧаса[историяЧаса.length - 1].mmol, atMs: историяЧаса[историяЧаса.length - 1].t }
    : null;
  /* Третьим кандидатом — стор: из него построен список «последних измерений», и без
     него круг мог промолчать при непустом списке прямо под собой. */
  const выбор = выбратьПоказание(
    m?.glucoseMmol != null && m.latestAtMs != null ? { mmol: m.glucoseMmol, atMs: m.latestAtMs } : null,
    последнееБазы,
    latest ? { mmol: latest.mmol, atMs: latest.t } : null,
  );
  const latestAt = выбор.показание?.atMs ?? m?.latestAtMs ?? latest?.t ?? null;

  // Головное значение — из выбранного источника; строка моста остаётся запасной на
  // случай, когда числом он не поделился (у нативного скелета glucose бывает строкой
  // «6.1 mmol/L» целиком, единицу показывает соседний .hp-unit).
  const glucose = выбор.показание ? toUnits(выбор.показание.mmol)
    : m ? m.glucose : latest ? toUnits(latest.mmol) : DASH;
  /* Одна таблица стрелок на всё приложение (domain/trend.ts). Их было две — по словам
     контракта здесь и по кодам Nightscout в сторе, — и при неизвестном направлении они
     вели себя по-разному: одна молчала, вторая рисовала «ровно» (#215). */
  /* Направление считаем сами и только сами (#215). Историю берём из своей базы, а не
     из ленты Nightscout-стора: с нативным движком стор пуст, а база наполняется из
     любого моста (sources/historySync.ts) — иначе стрелка пропала бы ровно тогда,
     когда сенсор читается напрямую. */
  const arrow = СТРЕЛКА[направление(историяЧаса)] ?? '';
  const латест = latestAt;
  const ago = latestAt != null ? сколькоНазад(latestAt) : DASH;
  const minsAgo = latestAt != null ? Math.round((Date.now() - latestAt) / 60000) : null;
  const fresh = minsAgo == null ? DASH : minsAgo < 1 ? 'сейчас' : minsAgo + ' мин';

  /* Расходка — из снимка, Nightscout запасным (#183). Разница не в источнике: у
     облачного числа нет ни возраста, ни принадлежности к конкретной помпе, и «37 ед»
     часовой давности выглядят так же, как свежие. */
  const расх = расходка(снимок, { reservoir: dev?.reservoir, pumpBattery: dev?.pumpBattery, at: dev?.at });
  const reservoir = расх.остаток != null ? Math.round(расх.остаток) + ' ед' : DASH;
  const pumpStatus = shortStatus(dev?.status);
  /* Активный инсулин в круге. Раньше строка просто исчезала, когда цикл молчал, —
     и пустота читалась как «инсулина нет». Теперь она на месте всегда, а неизвестное
     показано прочерком и приглушённым цветом (см. domain/loopValue.ts). */
  /* Число петли — из движка, когда он его отдаёт (#528). Раньше здесь стоял результат нашей
     собственной загрузки Nightscout: два источника об одном числе, и расходились они в самый
     неудобный момент — когда связь рвалась и движок объявлял молчание. */
  const петля = useЧужаяПетля();
  const ai = activeInsulin({ iob: петля.iob, loopAt: петля.loopAt } as typeof dev);
  const iobText = ai.known ? 'инс. ' + fmt(петля.iob as number) + ' ед' : 'инс. ' + DASH;

  // Полоса зарядов устройств над панелью — расширяемо: помпа, телефон-аплоадер, мост
  // (OrangeLink/RileyLink, pump.extended.OrangeLinkBattery от AAPS). Показываем только
  // то, что реально известно, без пустых иконок.
  const batteries: { id: string; icon: string; value: number | null }[] = [
    { id: 'pump', icon: flash, value: расх.заряд },
    { id: 'phone', icon: phonePortraitOutline, value: dev?.uploaderBattery ?? null },
    { id: 'mount', icon: gitNetworkOutline, value: dev?.mountBattery ?? null },
  ].filter((b) => b.value != null);

  // строка синхронизации: слева — как мы получаем (нами), справа — возраст
  // последнего значения в Nightscout, чтобы видеть задержку. + офлайн.
  // Короткая форма: строка статуса теперь всегда в одну линию рядом с зарядами,
  // и «назад» в ней — лишние ~35px, из-за которых текст обрезался на узких экранах.
  const readingAge = latestAt != null ? сколькоНазад(latestAt).replace(' назад', '') : null;
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
  /* Возраст ПОКАЗЫВАЕМОГО числа — то, чем круг и решает (#358). Раньше сюда шло только
     состояние источника, и при живом списке показаний круг показывал часики. */
  const круг = видКруга(снимок, латест != null ? Date.now() - латест : null);
  const сырое = предупредитьОСыром(снимок);
  const кругЖдёт = круг === 'ждём';
  /* Отстал не только по мнению моста, но и когда база его обогнала (#326).

     Мост считает себя живым, пока показанию меньше пятнадцати минут, — а человек
     видит в списке число свежее того, что в круге, и вопрос «почему так» возникает
     задолго до нашего порога. Молчание здесь хуже отставания: два разных числа без
     объяснения читаются как поломка. */
  /* «Отстало» — про ПОКАЗАННОЕ число, а не про мнение моста (#326).

     Мост может считать себя отставшим, а в круге при этом уже стоит свежее значение из
     базы: приглушать его было бы неправдой в другую сторону. И наоборот — мост считает
     себя живым до пятнадцати минут, а человек видит в списке число свежее того, что в
     круге, и спрашивает «почему», задолго до нашего порога.

     Поэтому решает возраст того, что показано, а состояние моста остаётся источником
     только для «ждём»: у него ещё не было ни одного показания, и возраст мерить не у
     чего. */
  const кругОтстал = (латест != null && Date.now() - латест > ОТСТАВАНИЕ_МС)
    || (круг === 'отстало' && выбор.откуда !== 'база');
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
    : data ? 'обновлено ' + сколькоНазад(data.updatedAt)
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
  const каналНмг = короткоКанал(спорныйКанал(устройствоРоли(снимок, 'sensor')));
  const каналПомпы = короткоКанал(спорныйКанал(устройствоРоли(снимок, 'pump')));

  // датчик (день N) — слева; запас инсулина (≈N дн) — справа
  const ages = deviceAges(extras.events, changes);
  /* Без настроенного источника день датчика не показываем: события замены лежат
     в локальной истории и пережили бы отключение, а «день 8» рядом с прочерками
     читается как живое состояние. Дальше см. DataGate в NotConfigured.tsx. */
  const sensorDay = status !== 'off' && ages.sensor ? ages.sensor.days + 1 : null;
  const nmgSub = sensorDay != null ? 'датчик' : 'обновлено';
  const nmgVal = sensorDay != null ? 'день ' + sensorDay : fresh;
  const daysLeft = расх.остаток != null && extras.tdd ? расх.остаток / extras.tdd : null;
  const resSub2 = daysLeft != null ? '≈ ' + дниЧасы(daysLeft) : 'резервуар';
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
            : <Иконка className="sync-ico" icon={syncState === 'poll' ? syncOutline : cloudOfflineOutline} />}
          <span>{syncMain}</span>
          {readingAge && <span className="sync-reading">· {readingAge}</span>}
        </span>
        {batteries.length > 0 && (
          <span className="hp-batteries">
            {batteries.map((b) => (
              <span key={b.id} className="hp-batt-item" style={{ color: battColor(b.value as number) }}>
                <Иконка icon={b.icon} />{b.value}%
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="hp-row">
        <div className="hp-rect">
          <button className="hp-wing hp-wing-l" onClick={() => setTab(1)}>
            <span className="hp-ico"><Иконка icon={pulse} /></span>
            <span className="hp-head">
              <span className="hp-name">НМГ</span>
              <ТочкаСвязи что={связьНмг} />
              {каналНмг && <span className="hp-chan">{каналНмг}</span>}
            </span>
            <span className="hp-sub">{nmgSub}{staleSensor && <Иконка className="hp-stale" icon={timeOutline} />}</span>
            <span className="hp-val">{nmgVal}</span>
          </button>

          <div className="hp-gap" />

          <button className="hp-wing hp-wing-r" onClick={() => setTab(3)}>
            <span className="hp-ico"><Иконка icon={flash} /></span>
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
            <span className="hp-sub">{resSub2}{staleDays && <Иконка className="hp-stale" icon={timeOutline} />}</span>
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
                ? <Иконка className={'hp-arrow hp-wait' + (кругЖдёт ? ' hp-wait-big' : '')} icon={timeOutline} />
                : arrow && <span className="hp-arrow">{arrow}</span>}
            </span>
            {/* Единица без числа — подпись к пустому месту, поэтому её тоже нет. */}
            {!кругЖдёт && <span className="hp-unit">{unitLabel()}</span>}
            <span className={'hp-iob' + (ai.known ? '' : ' is-unknown')} title={ai.reason ?? undefined}>{iobText}</span>
            {/* Возраст показания — единственная строка, которая при ожидании говорит
                по делу: «догоняю» отвечает на вопрос «почему пусто», а «5 мин назад»
                на него не отвечает, потому что показания ещё не было. */}
            {/* Сырое значение помечаем ПРЯМО У ЧИСЛА (SugarLifeCore#88): сенсор отдаёт
                сырьё, калибровки у нас пока нет, и на живом приборе разница с
                калиброванным была заметной. Оговорка в другом месте экрана не работает —
                смотрят сюда. */}
            <span className="hp-ago" title={сырое ? ПОЯСНЕНИЕ_СЫРОГО : undefined}>
              {кругЖдёт ? 'догоняю…' : сырое ? (
                <>
                  <Иконка icon={warningOutline} className="hp-raw-ico" />
                  {МЕТКА_СЫРОГО} · {ago}
                </>
              ) : ago}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
