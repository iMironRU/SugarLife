/* Стор живых данных Nightscout: initial по REST → живые апдейты по Socket.IO,
   поллинг (REST) остаётся страховкой на случай обрыва сокета/CORS.
   Кэш в localStorage (офлайн). Без конфига — данных нет, экраны показывают демо. */
import { useSyncExternalStore } from 'react';
import { getCfg, loadAll, checkWrite, type NsData, type Entry, type Treatment, type Device } from './nightscout';
import { connectSocket, disconnectSocket, type SocketData } from './nsSocket';
import { putEntries } from './db';
import { backfill } from './backfill';

const CACHE_KEY = 'sl.ns.cache.v1';
const POLL_MS = 60000;

export type Status = 'idle' | 'off' | 'loading' | 'ok' | 'stale' | 'error';
export interface StoreState {
  data: (NsData & { latest: Entry | null; updatedAt: number }) | null;
  status: Status;
  error: string | null;
  live: boolean; // сокет подключён
  writable: boolean; // токен даёт право записи (еда/болюсы)
}

let state: StoreState = { data: null, status: 'idle', error: null, live: false, writable: false };
const listeners = new Set<() => void>();
let inflight = false;
let started = false;
let socketUrl: string | null = null;
let writeCheckedToken: string | undefined | null = null; // null = ещё не проверяли

function emit() { for (const l of listeners) l(); }
function set(patch: Partial<StoreState>) { state = { ...state, ...patch }; emit(); }

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.entries) set({ data: c, status: 'stale' });
  } catch { /* ignore */ }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch { /* ignore */ }
}

// --- слияние дельт из сокета ---
function mergeSocket(d: SocketData) {
  const cur = state.data || { entries: [], device: null, profile: null, treatments: [], latest: null, updatedAt: 0 };
  let entries = cur.entries;
  if (d.entries && d.entries.length) {
    const map = new Map<number, Entry>(cur.entries.map((e) => [e.t, e]));
    for (const e of d.entries) map.set(e.t, e);
    entries = [...map.values()].sort((a, b) => a.t - b.t).slice(-288);
  }
  let treatments = cur.treatments || [];
  if (d.treatments && d.treatments.length) {
    const key = (x: Treatment) => x.t + '|' + x.type;
    const map = new Map<string, Treatment>((cur.treatments || []).map((x) => [key(x), x]));
    for (const x of d.treatments) map.set(key(x), x);
    treatments = [...map.values()].sort((a, b) => a.t - b.t).slice(-200);
  }
  const device: Device | null = d.device !== undefined ? d.device : cur.device;
  const latest = entries.length ? entries[entries.length - 1] : cur.latest;
  set({ data: { ...cur, entries, treatments, device, latest, updatedAt: Date.now() }, status: 'ok', error: null });
  saveCache();
  if (d.entries && d.entries.length) putEntries(d.entries);
}

// подключить/переподключить/отключить сокет по конфигу
function ensureSocket(cfg: ReturnType<typeof getCfg>) {
  const want = cfg && cfg.enabled && cfg.url ? cfg.url : null;
  if (want === socketUrl) return;
  disconnectSocket();
  socketUrl = want;
  set({ live: false });
  if (want) {
    connectSocket(want, cfg!.token, mergeSocket, (connected) => set({ live: connected }));
  }
}

// Проверка права записи только при смене токена/URL (не на каждый поллинг).
function ensureWriteCheck(cfg: ReturnType<typeof getCfg>) {
  const key = cfg && cfg.enabled && cfg.url ? (cfg.token || '') : undefined;
  if (key === writeCheckedToken) return;
  writeCheckedToken = key;
  if (!key || !cfg) { set({ writable: false }); return; }
  checkWrite(cfg.url, cfg.token).then((w) => {
    if (writeCheckedToken === key) set({ writable: w });
  }).catch(() => { if (writeCheckedToken === key) set({ writable: false }); });
}

export async function refresh() {
  const cfg = getCfg();
  ensureSocket(cfg);
  ensureWriteCheck(cfg);
  if (inflight) return;
  if (!cfg || !cfg.enabled || !cfg.url) { set({ status: 'off', error: null, writable: false }); return; }
  inflight = true;
  if (!state.data) set({ status: 'loading' });
  try {
    const res = await loadAll(cfg);
    const entries = res.entries || [];
    const latest = entries.length ? entries[entries.length - 1] : null;
    set({ data: { ...res, entries, latest, updatedAt: Date.now() }, status: 'ok', error: null });
    saveCache();
    putEntries(entries);
    backfill(); // фоновая докачка истории в БД
  } catch (e: any) {
    set({ status: state.data ? 'stale' : 'error', error: String(e?.message || e) });
  } finally {
    inflight = false;
  }
}

function start() {
  if (started) return;
  started = true;
  loadCache();
  refresh();
  setInterval(refresh, POLL_MS);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  start();
  return () => { listeners.delete(cb); };
}
function getSnapshot() { return state; }

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Право записи в Nightscout. Гейтить им весь ввод (еда/болюсы/запись).
export function useWritable(): boolean {
  return useSyncExternalStore(subscribe, () => state.writable);
}
