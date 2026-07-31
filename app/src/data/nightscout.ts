/* Адаптер Nightscout (read-only). Порт из ваниль-версии.
   Ходит напрямую из браузера (у Nightscout по умолчанию CORS + роль readable). */

export interface NsConfig { url: string; token?: string; enabled: boolean }
export interface Entry { t: number; mgdl: number; mmol: number; dir: string }
export interface Device {
  iob: number | null; cob: number | null; reservoir: number | null;
  pumpBattery: number | null; status: string | null; baseBasal: number | null;
  tempRate: number | null; tempRemaining: number | null; lastBolus: number | null;
  uploaderBattery: number | null; loop: boolean; pump: boolean; at: number | null;
}
export interface Profile {
  name: string; ic: number | null; isf: number | null; basal: number | null;
  targetLow: number | null; targetHigh: number | null; dia: number | null; units?: string;
}
export interface Treatment { t: number; type: string; carbs: number | null; insulin: number | null; rate: number | null; duration: number | null }

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

// Разрешает ли право создавать/менять treatments (shiro-стиль api:treatments:create).
function grantsTreatmentWrite(p: string): boolean {
  if (!p) return false;
  if (p === '*' || p === '*:*:*') return true;
  const [a = '', b = '', c = ''] = p.split(':');
  return (a === 'api' || a === '*') && (b === 'treatments' || b === '*') && (c === 'create' || c === 'update' || c === '*');
}

function collectPerms(j: any): string[] {
  const out: string[] = [];
  const pushGroups = (g: any) => { if (Array.isArray(g)) for (const arr of g) if (Array.isArray(arr)) out.push(...arr); };
  pushGroups(j?.permissionGroups);
  if (Array.isArray(j?.permissions)) out.push(...j.permissions);
  // запасной путь: разобрать JWT из ответа
  if (typeof j?.token === 'string' && j.token.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(j.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (Array.isArray(payload?.permissions)) out.push(...payload.permissions);
      pushGroups(payload?.permissionGroups);
      if (typeof payload?.scope === 'string') out.push(...payload.scope.split(/\s+/));
    } catch { /* ignore */ }
  }
  return out;
}

// Есть ли у токена право записи в Nightscout (создавать treatments).
// Fail-closed: нет токена / невалидный / неопределённо → false (только чтение).
export async function checkWrite(base: string, token?: string): Promise<boolean> {
  const t = (token || '').trim();
  if (!t) return false;
  const url = String(base || '').trim().replace(/\/+$/, '') + '/api/v2/authorization/request/' + encodeURIComponent(t);
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return false;
    const j = await r.json();
    return collectPerms(j).some(grantsTreatmentWrite);
  } catch { return false; }
}

// Загрузка entries за период (дней). count ограничен, для длинных периодов — выборка.
export async function loadEntriesRange(base: string, token: string | undefined, days: number): Promise<Entry[]> {
  const count = Math.min(days * 300, 8000);
  return loadEntries(base, token, count);
}

// Загрузка entries по диапазону времени [from, to) (мс) — для наполнения локальной БД.
export async function loadEntriesWindow(base: string, token: string | undefined, from: number, to: number): Promise<Entry[]> {
  const path = `/api/v1/entries.json?count=100000&find[date][$gte]=${from}&find[date][$lt]=${to}`;
  const raw = await getJSON(base, path, token, 25000);
  return (Array.isArray(raw) ? raw : [])
    .map(normSgv).filter((e): e is Entry => e != null)
    .sort((a, b) => a.t - b.t);
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

// Нормализация одного документа devicestatus (переиспользуется REST + сокетом)
export function normDeviceDoc(d: any): Device | null {
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
    tempRemaining: num(ext.TempBasalRemaining),
    lastBolus: num(ext.LastBolusAmount),
    uploaderBattery: num(d.uploaderBattery, d.uploader?.battery),
    loop: !!(d.openaps || d.loop),
    pump: !!(pump && (pump.reservoir != null || pump.extended || pump.status)),
    at: d.date || (d.mills) || (d.created_at && Date.parse(d.created_at)) || null,
  };
}

// Нормализация SGV из сокета ({mills, mgdl, direction}) или REST ({date/dateString, sgv})
export function normSgv(s: any): Entry | null {
  const mgdl = num(s.mgdl, s.sgv);
  const t = s.mills || s.date || (s.dateString && Date.parse(s.dateString));
  if (mgdl == null || !t) return null;
  return { t, mgdl, mmol: mgdl / MGDL_PER_MMOL, dir: s.direction || 'Flat' };
}

// Нормализация treatment из сокета/REST
export function normTreatment(t: any): Treatment | null {
  const tt = t.mills || t.date || (t.created_at && Date.parse(t.created_at));
  if (!tt) return null;
  return {
    t: tt, type: t.eventType || '', carbs: num(t.carbs), insulin: num(t.insulin),
    rate: num(t.rate, t.absolute), duration: num(t.duration),
  };
}

// События (без Temp Basal) за период: болюсы, углеводы, замены датчика/канюли/резервуара/батареи.
// Лёгкий запрос — исключаем частые Temp Basal.
export async function loadEventsRange(base: string, token: string | undefined, days: number): Promise<Treatment[]> {
  const since = Date.now() - days * 86400e3;
  const iso = new Date(since).toISOString();
  const path = `/api/v1/treatments.json?count=100000&find[eventType][$ne]=${encodeURIComponent('Temp Basal')}&find[created_at][$gte]=${encodeURIComponent(iso)}`;
  const raw = await getJSON(base, path, token, 20000);
  return (Array.isArray(raw) ? raw : []).map(normTreatment).filter((x): x is Treatment => x != null).sort((a, b) => a.t - b.t);
}

// Загрузка treatments за период (дней)
export async function loadTreatmentsRange(base: string, token: string | undefined, days: number): Promise<Treatment[]> {
  const since = Date.now() - days * 86400e3;
  const path = `/api/v1/treatments.json?count=50000&find[created_at][$gte]=${new Date(since).toISOString()}`;
  const raw = await getJSON(base, path, token);
  return (Array.isArray(raw) ? raw : []).map(normTreatment).filter((x): x is Treatment => x != null).sort((a, b) => a.t - b.t);
}

async function loadDeviceStatus(base: string, token?: string): Promise<Device | null> {
  const raw = await getJSON(base, '/api/v1/devicestatus.json?count=1', token);
  return normDeviceDoc(Array.isArray(raw) ? raw[0] : null);
}

export interface DevPoint { t: number; reservoir: number | null; pumpBattery: number | null; uploaderBattery: number | null; }

// История devicestatus (резервуар/батареи во времени) — для расхода инсулина и заправок.
export async function loadDeviceStatusRange(base: string, token: string | undefined, count = 2000): Promise<DevPoint[]> {
  const raw = await getJSON(base, '/api/v1/devicestatus.json?count=' + count, token, 25000);
  if (!Array.isArray(raw)) return [];
  return raw.map((d: any) => {
    const pump = d.pump || {};
    return {
      t: d.date || Date.parse(d.created_at) || 0,
      reservoir: num(pump.reservoir),
      pumpBattery: num(pump.battery?.percent),
      uploaderBattery: num(d.uploaderBattery, d.uploader?.battery),
    };
  }).filter((p: DevPoint) => p.t > 0).sort((a: DevPoint, b: DevPoint) => a.t - b.t);
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
  return (Array.isArray(raw) ? raw : []).map(normTreatment).filter((x): x is Treatment => x != null);
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
