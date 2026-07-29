/* Стор живых данных Nightscout: поллинг + кэш (localStorage) + офлайн.
   Без конфига — данных нет, экраны показывают демо-наборы. */
import { useSyncExternalStore } from 'react';
import { getCfg, loadAll, type NsData, type Entry } from './nightscout';

const CACHE_KEY = 'sl.ns.cache.v1';
const POLL_MS = 60000;

export type Status = 'idle' | 'off' | 'loading' | 'ok' | 'stale' | 'error';
export interface StoreState {
  data: (NsData & { latest: Entry | null; updatedAt: number }) | null;
  status: Status;
  error: string | null;
}

let state: StoreState = { data: null, status: 'idle', error: null };
const listeners = new Set<() => void>();
let inflight = false;
let started = false;

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

export async function refresh() {
  if (inflight) return;
  const cfg = getCfg();
  if (!cfg || !cfg.enabled || !cfg.url) { set({ status: 'off', error: null }); return; }
  inflight = true;
  if (!state.data) set({ status: 'loading' });
  try {
    const res = await loadAll(cfg);
    const entries = res.entries || [];
    const latest = entries.length ? entries[entries.length - 1] : null;
    set({ data: { ...res, entries, latest, updatedAt: Date.now() }, status: 'ok', error: null });
    saveCache();
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
