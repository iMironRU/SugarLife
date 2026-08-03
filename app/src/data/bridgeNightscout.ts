/* Nightscout-шим моста: реализует SibionicBridge поверх нашего стора Nightscout.
   Когда появится нативный мост (оболочка/релей) — UI не меняется, просто
   getBridge() вернёт его вместо шима. Пока: живой монитор + alerts из Nightscout.
   Гэпы честно: один IOB (→ conservative), нет истории/транзакций/wiring/insights. */
import type { SibionicBridge, UiSnapshot, Monitor, Trend, Link, DeviceInfo, Alert, Intent } from './bridge';
import { subscribeStore, getStoreState, refresh } from './store';
import { getUnit, subscribeUnit, toUnits } from './units';
import { getCfg, setCfg } from './nightscout';

function trendOf(dir: string): Trend {
  switch (dir) {
    case 'DoubleUp': return 'RisingRapidly';
    case 'SingleUp': return 'Rising';
    case 'FortyFiveUp': return 'RisingSlowly';
    case 'Flat': return 'Stable';
    case 'FortyFiveDown': return 'FallingSlowly';
    case 'SingleDown': return 'Falling';
    case 'DoubleDown': return 'FallingRapidly';
    default: return 'Unknown';
  }
}

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
    trend: latest ? trendOf(latest.dir) : '—',
    link,
    reservoir: d?.reservoir != null ? Math.round(d.reservoir) + ' ед' : '—',
    battery: d?.pumpBattery != null ? d.pumpBattery + '%' : '—',
    // Nightscout отдаёт один IOB → он же conservative; разложение даст ядро.
    confirmedIOB: iob, assumedIOB: 0, conservativeIOB: iob,
  };

  const devices: DeviceInfo[] = cfg?.url ? [{
    id: 'nightscout', name: 'Nightscout', kind: 'service',
    roles: ['GlucoseSource', 'PumpStateSource', 'DeliveryHistorySource'],
    connection: link, capabilities: { trust: 'Relayed', read: 'true' },
    settings: { parameters: [
      { key: 'url', title: 'Адрес Nightscout', type: 'Text', required: true, default: cfg?.url ?? null, options: [] },
      { key: 'token', title: 'Токен (для записи)', type: 'Secret', required: false, default: null, options: [] },
    ] },
    admittedInput: true, admittedOutput: !!st.writable, testable: true,
  }] : [];

  const alerts: Alert[] = [];
  if (cfg?.url && (link === 'Error' || link === 'Disconnected')) alerts.push({ level: 'warn', text: 'Нет связи с Nightscout' });
  if (d?.pumpBattery != null && d.pumpBattery <= 15) alerts.push({ level: 'warn', text: 'Низкий заряд помпы' });

  return { bridgeRevision: '1.0', monitor, devices, insights: null, pendingWrites: [], alerts };
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

export const nightscoutBridge: SibionicBridge = {
  bridgeRevision: '1.0',
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
