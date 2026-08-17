/* Nightscout-шим моста: реализует SugarLifeBridge поверх нашего стора Nightscout.
   Когда появится нативный мост (оболочка/релей) — UI не меняется, просто
   getBridge() вернёт его вместо шима. Пока: живой монитор + alerts из Nightscout.
   Гэпы честно: один IOB (→ conservative), нет истории/транзакций/wiring/insights. */
import type { SugarLifeBridge, UiSnapshot, Monitor, Link, DeviceView, Alert, Intent, DriverDescriptor, HistoryQuery, HistoryResult, SourceStatus } from './bridge';
import { getSince, getTreatmentsSince } from './db';
import { subscribeStore, getStoreState, refresh } from './store';
import { getUnit, subscribeUnit, toUnits } from '@/domain/units';
import { направление } from '@/domain/trend';
import type { Entry } from './nightscout';
import { getCfg, setCfg } from './nightscout';

function linkOf(live: boolean, status: string): Link {
  if (live) return 'Streaming';
  switch (status) {
    case 'ok': return 'Connected';
    case 'loading': return 'Connecting';
    case 'stale':
    case 'error': return 'Error';
    default: return 'Disconnected';
  }
}

/* Жизненный цикл получения данных — не то же, что состояние связи (Link).
   Связь может быть, а показаний ещё нет (Acquiring) или они уже отстают (Delayed).
   Порог отставания — 15 минут: сенсор пишет раз в минуту-пять, и четверть часа
   молчания это уже не задержка сети. */
const ОТСТАВАНИЕ_МС = 15 * 60e3;

/* СВЕЖИЕ ДАННЫЕ — ЭТО 'LIVE', ДАЖЕ КОГДА СОКЕТА НЕТ (SugarLife#358).

   Здесь стояло `live ? 'Live' : 'Acquiring'`, где `live` — «подключён хотя бы один
   сокет». Получалось так: сокет отвалился, опрос раз в минуту продолжает приносить
   показания, свежесть — минута, а мы объявляем 'Acquiring', то есть «связь есть,
   показаний ещё нет». Прямая неправда: показания есть.

   Ловится это возвращением приложения из фона — сокет там рвётся штатно, а опрос живёт.
   Человек видел часики и «догоняю…» над списком, где верхней строчкой стоит показание
   минутной давности.

   Способ доставки не входит в вопрос «идут ли данные». Сокет или опрос — дело наше;
   человеку важно, свежее ли число, и на это отвечает его возраст. `Acquiring` остаётся
   там, где он и означает своё: показаний нет вовсе (строка выше).

   Отсюда же и «часики» в круге: они читали этот статус и верили ему. Правило круга тоже
   поправлено (domain/deviceState), но причина была здесь. */
function sourceStatusOf(live: boolean, status: string, latestAt: number | null): SourceStatus {
  if (status === 'off' || status === 'idle') return 'Disconnected';
  if (status === 'loading') return 'Connecting';
  if (latestAt == null) return 'Acquiring';
  if (Date.now() - latestAt > ОТСТАВАНИЕ_МС || status === 'stale' || status === 'error') return 'Delayed';
  return 'Live';
}
export const _sourceStatusOf = sourceStatusOf;   // для теста: правило важнее сборки снимка

function buildSnapshot(): UiSnapshot {
  const st = getStoreState();
  const u = getUnit();
  const d = st.data?.device || null;
  const latest = st.data?.latest || null;
  const cfg = getCfg();
  const iob = d?.iob ?? 0;
  const link = linkOf(st.live, st.status);

  const monitor: Monitor = {
    glucose: latest ? toUnits(latest.mmol, u) : '—',
    glucoseMmol: latest ? latest.mmol : null,
    /* Направление: слово источника, а если он промолчал — наш расчёт по истории
       (domain/trend.ts). Раньше на этом месте была подстановка «ровно», то есть
       утверждение, которого никто не делал (SugarLife#215). */
    trend: направление((st.data?.entries ?? []) as Entry[]),
    link,
    reservoir: d?.reservoir != null ? Math.round(d.reservoir) + ' ед' : '—',
    battery: d?.pumpBattery != null ? d.pumpBattery + '%' : '—',
    // Nightscout отдаёт один IOB → он же conservative; разложение даст ядро.
    confirmedIOB: iob, assumedIOB: 0, conservativeIOB: iob,
    /* Время расчёта IOB (1.8). Без него три числа выше врут: цикл молчит, а мост
       сообщает «подтверждено: инсулина ноль». Ноль в contract — единственное
       представимое значение, поэтому читатель обязан свериться со временем.
       У нас оно есть: Device.loopAt — штамп документа, где реально был openaps.iob. */
    iobAtMs: d?.loopAt ?? null,
    // rev 1.7: единая картина основного источника — раньше возраст показания
    // каждый экран считал сам, и «свежо ли» у всех получалось по-своему
    live: st.live,
    status: sourceStatusOf(st.live, st.status, latest?.t ?? null),
    latestAtMs: latest?.t ?? null,
    source: cfg?.url ? 'Nightscout' : null,
  };

  /* Устройство и монитор — из ОДНОГО вычисления, как это гарантирует движок после
     SugarLifeCore#22. Раньше устройство несло только connection (состояние сокета), а
     статус и живость были лишь у монитора; интерфейсу приходилось знать, что монитор
     точнее, и держать для этого отдельную ветку.

     Разница не теоретическая: сокет к Nightscout бывает жив, когда показания стоят
     пятнадцать минут. Устройство с одним линком в таком состоянии выглядело живым. */
  const devices: DeviceView[] = cfg?.url ? [{
    id: 'nightscout', name: 'Nightscout', kind: 'service',
    roles: ['GlucoseSource', 'PumpStateSource', 'DeliveryHistorySource'],
    connection: link, capabilities: { trust: 'Relayed', read: 'true' },
    live: monitor.live, status: monitor.status, latestAtMs: monitor.latestAtMs,
    /* Единственный источник глюкозы в браузере — он и основной. Без пометки выбор
       «кто основной» зависел бы от порядка в списке, а список из одного элемента
       сегодня и из двух завтра. */
    primary: true,
    settings: { parameters: [
      { key: 'url', title: 'Адрес Nightscout', type: 'Text', required: true, default: cfg?.url ?? null, options: [] },
      { key: 'token', title: 'Токен (для записи)', type: 'Secret', required: false, default: null, options: [] },
    ] },
    admittedInput: true, admittedOutput: !!st.writable, testable: true,
  }] : [];

  const alerts: Alert[] = [];
  if (cfg?.url && (link === 'Error' || link === 'Disconnected')) alerts.push({ level: 'warn', text: 'Нет связи с Nightscout' });
  if (d?.pumpBattery != null && d.pumpBattery <= 15) alerts.push({ level: 'warn', text: 'Низкий заряд помпы' });

  // Честно: этот мост не умеет сканировать эфир (браузер/Nightscout-only) — скана и
  // опознанных устройств никогда не будет. Единственный «драйвер» — сам Nightscout
  // (ручное добавление через существующую форму url/token, не через скан).
  const availableDrivers: DriverDescriptor[] = [{
    id: 'nightscout', displayName: 'Nightscout', kind: 'service',
    roles: ['GlucoseSource', 'PumpStateSource', 'DeliveryHistorySource'],
    settings: {
      parameters: [
        { key: 'url', title: 'Адрес Nightscout', type: 'Text', required: true, default: null, options: [] },
        { key: 'token', title: 'Токен (для записи)', type: 'Secret', required: false, default: null, options: [] },
      ],
    },
    available: true, canActivate: false, providesTransportFor: [],
  }];

  return {
    bridgeRevision: '1.7', monitor, devices, insights: null, pendingWrites: [], alerts,
    scanning: false, discovered: [], availableDrivers, logging: null,
  };
}

const cbs = new Set<(s: UiSnapshot) => void>();
let current: UiSnapshot | null = null;
let started = false;

function rebuild() {
  current = buildSnapshot();
  for (const cb of cbs) cb(current);
}

function ensureStarted() {
  if (started) return;
  started = true;
  subscribeStore(rebuild); // натив-подписка: стор меняется → пересобираем снимок
  subscribeUnit(rebuild);  // смена единиц тоже влияет на строки монитора
}

async function sendIntent(i: Intent): Promise<{ accepted: boolean; error?: string }> {
  switch (i.type) {
    case 'addDevice':
    case 'setParams': {
      const cur = getCfg();
      const url = i.params.url ?? cur?.url;
      if (!url) return { accepted: false, error: 'no url' };
      setCfg({ url, token: i.params.token ?? cur?.token ?? '', enabled: true });
      refresh();
      return { accepted: true };
    }
    case 'connect': { const c = getCfg(); if (c) setCfg({ ...c, enabled: true }); refresh(); return { accepted: true }; }
    case 'disconnect': { const c = getCfg(); if (c) setCfg({ ...c, enabled: false }); refresh(); return { accepted: true }; }
    case 'testDevice':
    case 'readNow': { refresh(); return { accepted: true }; }
    default:
      // wiring/algorithm/reconcile/… — появятся с нативным ядром
      return { accepted: false, error: 'intent не поддержан Nightscout-шимом: ' + i.type };
  }
}

/* История для графиков (rev ≥ 1.1). Шим отдаёт её из локальной IndexedDB — той самой,
   куда он же складывает всё, что приходит из Nightscout. Ходить за окном истории в сеть
   не надо: она уже лежит рядом, и это единственный источник правды по истории в
   приложении (sources/db.ts). */
async function query(q: HistoryQuery): Promise<HistoryResult> {
  const внутри = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t >= q.fromMs && x.t < q.toMs);
  const нужнаГлюкоза = q.kind === 'Glucose' || q.kind === 'Both';
  const нужноЛечение = q.kind === 'Treatments' || q.kind === 'Both';

  const entries = нужнаГлюкоза ? внутри(await getSince(q.fromMs)) : [];
  const treatments = нужноЛечение ? внутри(await getTreatmentsSince(q.fromMs)) : [];

  /* Прореживание — равномерное по индексу, а не «каждая N-я по времени»: у графика
     важна форма кривой, а в истории есть пропуски, и по времени они дали бы рваный шаг. */
  const шаг = q.maxPoints && entries.length > q.maxPoints ? Math.ceil(entries.length / q.maxPoints) : 1;
  const глюкоза = шаг > 1 ? entries.filter((_, i) => i % шаг === 0) : entries;

  return {
    glucose: глюкоза.map((e) => ({ atMs: e.t, mmol: e.mmol, source: 'nightscout', trend: e.dir ?? null })),
    treatments: treatments.map((t) => ({
      atMs: t.t, kind: t.type, amount: t.insulin ?? t.carbs ?? 0,
      evidence: 'Reported', source: 'nightscout',
    })),
  };
}

export const nightscoutBridge: SugarLifeBridge = {
  bridgeRevision: '1.7',
  query,
  subscribe(cb) {
    ensureStarted();
    cbs.add(cb);
    if (!current) current = buildSnapshot();
    cb(current); // отдать текущий сразу
    return () => { cbs.delete(cb); };
  },
  requestSnapshot() { return Promise.resolve(buildSnapshot()); },
  sendIntent,
};
