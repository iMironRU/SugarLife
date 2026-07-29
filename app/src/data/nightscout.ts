/* Адаптер Nightscout (read-only). Порт из ваниль-версии.
   Ходит напрямую из браузера (у Nightscout по умолчанию CORS + роль readable). */

export interface NsConfig { url: string; token?: string; enabled: boolean }
export interface Entry { t: number; mgdl: number; mmol: number; dir: string }
export interface Device {
  iob: number | null; cob: number | null; reservoir: number | null;
  pumpBattery: number | null; status: string | null; baseBasal: number | null;
  tempRate: number | null; lastBolus: number | null; at: number | null;
}
export interface Profile {
  name: string; ic: number | null; isf: number | null; basal: number | null;
  targetLow: number | null; targetHigh: number | null; dia: number | null; units?: string;
}
export interface Treatment { t: number; type: string; carbs: number | null; insulin: number | null }

const CFG_KEY = 'sl.ns.cfg';
export const MGDL_PER_MMOL = 18.0;

export function getCfg(): NsConfig | null {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}
export function setCfg(cfg: NsConfig | null) {
  if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(CFG_KEY);
}

const ARROWS: Record<string, string> = {
  DoubleUp: 'arrow-up', SingleUp: 'arrow-up', FortyFiveUp: 'arrow-up',
  Flat: 'arrow-forward', FortyFiveDown: 'arrow-down', SingleDown: 'arrow-down', DoubleDown: 'arrow-down',
};
// Стрелка тренда как символ (для крупного значения)
const ARROW_CHAR: Record<string, string> = {
  DoubleUp: '⇈', SingleUp: '↑', FortyFiveUp: '↗', Flat: '→',
  FortyFiveDown: '↘', SingleDown: '↓', DoubleDown: '⇊',
};
export function arrowIcon(dir: string) { return ARROWS[dir] || 'arrow-forward'; }
export function arrowChar(dir: string) { return ARROW_CHAR[dir] || '→'; }

function num(...xs: any[]): number | null {
  for (const x of xs) if (typeof x === 'number' && !isNaN(x)) return x;
  return null;
}

function joinUrl(base: string, path: string, token?: string) {
  let u = String(base || '').trim().replace(/\/+$/, '') + path;
  if (token) u += (path.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
  return u;
}

async function getJSON(base: string, path: string, token?: string, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(joinUrl(base, path, token), { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('Nightscout ' + path + ' → HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}

export async function ping(base: string, token?: string) {
  const [entries, status] = await Promise.all([
    getJSON(base, '/api/v1/entries.json?count=1', token),
    getJSON(base, '/api/v1/status.json', token).catch(() => null),
  ]);
  const e = Array.isArray(entries) ? entries.find((x: any) => x && x.sgv != null) : null;
  return {
    ok: !!e, version: status?.version, name: status?.name,
    latestMgdl: e ? e.sgv : null, latestMmol: e ? +(e.sgv / MGDL_PER_MMOL).toFixed(1) : null,
    at: e ? (e.date || Date.parse(e.dateString)) : null,
  };
}

async function loadEntries(base: string, token?: string, count = 288): Promise<Entry[]> {
  const raw = await getJSON(base, '/api/v1/entries.json?count=' + count, token);
  return (Array.isArray(raw) ? raw : [])
    .filter((e: any) => e && e.sgv != null)
    .map((e: any) => ({ t: e.date || Date.parse(e.dateString), mgdl: e.sgv, mmol: e.sgv / MGDL_PER_MMOL, dir: e.direction || 'Flat' }))
    .filter((e: Entry) => !!e.t)
    .sort((a: Entry, b: Entry) => a.t - b.t);
}

function slotValue(schedule: any[]): number | null {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  const now = new Date();
  const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  let val = schedule[0].value;
  for (const s of schedule) { const t = s.timeAsSeconds != null ? s.timeAsSeconds : 0; if (t <= sec) val = s.value; }
  return val;
}

async function loadDeviceStatus(base: string, token?: string): Promise<Device | null> {
  const raw = await getJSON(base, '/api/v1/devicestatus.json?count=1', token);
  const d = Array.isArray(raw) ? raw[0] : null;
  if (!d) return null;
  const oa = d.openaps || {}, loop = d.loop || {}, pump = d.pump || {}, ext = pump.extended || {};
  return {
    iob: num(oa.iob?.iob, loop.iob?.iob),
    cob: num(oa.suggested?.COB, oa.cob, loop.cob?.cob),
    reservoir: num(pump.reservoir),
    pumpBattery: num(pump.battery?.percent),
    status: pump.status?.status || null,
    baseBasal: num(ext.BaseBasalRate),
    tempRate: num(ext.TempBasalAbsoluteRate),
    lastBolus: num(ext.LastBolusAmount),
    at: d.date || (d.created_at && Date.parse(d.created_at)) || null,
  };
}

async function loadProfile(base: string, token?: string): Promise<Profile | null> {
  const raw = await getJSON(base, '/api/v1/profile.json', token);
  const doc = Array.isArray(raw) ? raw[0] : raw;
  if (!doc || !doc.store) return null;
  const key = (doc.defaultProfile && doc.store[doc.defaultProfile]) ? doc.defaultProfile : Object.keys(doc.store)[0];
  const p = doc.store[key] || {};
  return {
    name: key, ic: slotValue(p.carbratio), isf: slotValue(p.sens), basal: slotValue(p.basal),
    targetLow: slotValue(p.target_low), targetHigh: slotValue(p.target_high), dia: num(p.dia), units: p.units,
  };
}

async function loadTreatments(base: string, token?: string, count = 120): Promise<Treatment[]> {
  const raw = await getJSON(base, '/api/v1/treatments.json?count=' + count, token);
  return (Array.isArray(raw) ? raw : [])
    .map((t: any) => ({ t: t.date || (t.created_at && Date.parse(t.created_at)) || null, type: t.eventType || '', carbs: num(t.carbs), insulin: num(t.insulin) }))
    .filter((x: any) => !!x.t);
}

export interface NsData { entries: Entry[]; device: Device | null; profile: Profile | null; treatments: Treatment[] }
export async function loadAll(cfg: NsConfig): Promise<NsData> {
  const { url, token } = cfg;
  const [entries, device, profile, treatments] = await Promise.all([
    loadEntries(url, token, 288),
    loadDeviceStatus(url, token).catch(() => null),
    loadProfile(url, token).catch(() => null),
    loadTreatments(url, token, 120).catch(() => [] as Treatment[]),
  ]);
  return { entries, device, profile, treatments };
}
