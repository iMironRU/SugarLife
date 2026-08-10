/* Единый источник «расширенных» данных устройства для панели и «Сегодня»:
   события (возраст датчика, углеводы дня), история резервуара, средний расход
   инсулина за 90 дн. Грузится ОДИН раз (владелец — постоянная HeroPanel),
   оба потребителя читают через useDeviceExtras() — без дублирования запросов. */
import { useSyncExternalStore } from 'react';
import {
  getCfg, loadEventsRange, loadDeviceStatusRange, loadTreatmentsRange,
  type Treatment, type DevPoint,
} from './nightscout';
import { insulinDaily } from '@/domain/treatmentStats';

export interface DeviceExtras {
  events: Treatment[];
  devHist: DevPoint[];
  tdd: number | null; // средний суточный расход инсулина за 90 дн
  loaded: boolean;
  stale: boolean; // показаны кешированные значения, идёт обновление
}

// Лёгкий кеш панели (день датчика + запас в днях), чтобы при старте не мигали
// подписи: показываем прошлые значения сразу, помечаем «обновляем», подменяем
// на свежие без смены текста. devHist в кеш не кладём — он тяжёлый и нужен
// только на экране инсулина, где догрузится обычным обновлением.
const CACHE_KEY = 'sl.extras.cache.v1';
function loadCache(): { events: Treatment[]; tdd: number | null } | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return c && Array.isArray(c.events) ? c : null;
  } catch { return null; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ events: extras.events, tdd: extras.tdd })); } catch { /* ignore */ }
}

const cached = loadCache();
let extras: DeviceExtras = cached
  ? { events: cached.events, devHist: [], tdd: cached.tdd, loaded: false, stale: true }
  : { events: [], devHist: [], tdd: null, loaded: false, stale: false };
const subs = new Set<() => void>();
let inflight = false;

// Подгрузить/обновить расширенные данные. Безопасно звать часто — параллельные
// вызовы схлопываются (inflight).
export async function loadDeviceExtras(): Promise<void> {
  const cfg = getCfg();
  if (!cfg?.enabled || !cfg.url || inflight) return;
  inflight = true;
  try {
    const [events, devHist, tb] = await Promise.all([
      loadEventsRange(cfg.url, cfg.token, 50),
      loadDeviceStatusRange(cfg.url, cfg.token, 2000),
      loadTreatmentsRange(cfg.url, cfg.token, 90),
    ]);
    const id = insulinDaily(tb, []);
    extras = { events, devHist, tdd: id.tddPerDay > 5 ? id.tddPerDay : null, loaded: true, stale: false };
    saveCache();
    subs.forEach((f) => f());
  } catch {
    /* ignore — панель просто покажет прочерки */
  } finally {
    inflight = false;
  }
}

export function useDeviceExtras(): DeviceExtras {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => extras,
  );
}
