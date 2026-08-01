/* Единый источник «расширенных» данных устройства для панели и «Сегодня»:
   события (возраст датчика, углеводы дня), история резервуара, средний расход
   инсулина за 90 дн. Грузится ОДИН раз (владелец — постоянная HeroPanel),
   оба потребителя читают через useDeviceExtras() — без дублирования запросов. */
import { useSyncExternalStore } from 'react';
import {
  getCfg, loadEventsRange, loadDeviceStatusRange, loadTreatmentsRange,
  type Treatment, type DevPoint,
} from './nightscout';
import { insulinDaily } from './treatmentStats';

export interface DeviceExtras {
  events: Treatment[];
  devHist: DevPoint[];
  tdd: number | null; // средний суточный расход инсулина за 90 дн
  loaded: boolean;
}

let extras: DeviceExtras = { events: [], devHist: [], tdd: null, loaded: false };
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
    extras = { events, devHist, tdd: id.tddPerDay > 5 ? id.tddPerDay : null, loaded: true };
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
