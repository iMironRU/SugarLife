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

/* Как часто обновлять — по существу данных, а не «почаще на всякий случай».

   Раньше всё это грузилось каждые 2 минуты, и разбор ответов блокировал поток:
   2000 статусов помпы — 576 мс, 90 дней лечения — 373 мс, 50 дней событий — 318 мс.
   Полторы секунды рывков каждые две минуты, на любом экране. Именно это и
   ощущалось как «спотыкается», хотя искали мы сперва в аналитике.

   Что здесь на самом деле меняется:
   • события замен (день датчика, возраст канюли) — раз в несколько дней;
   • история резервуара — нужна, чтобы заметить «подача идёт, а остаток стоит»,
     и порог там 8 часов;
   • средний расход за 90 дней — от одного дня не сдвигается.

   Поэтому: события и резервуар раз в 15 минут, расход — раз в час. */
const ЧАСТО = 15 * 60e3;
const РЕДКО = 60 * 60e3;
let времяСобытий = 0, времяРасхода = 0;
let tbКеш: Treatment[] = [];

export async function loadDeviceExtras(force = false): Promise<void> {
  const cfg = getCfg();
  if (!cfg?.enabled || !cfg.url || inflight) return;
  const now = Date.now();
  const пораСобытия = force || now - времяСобытий >= ЧАСТО;
  const пораРасход = force || now - времяРасхода >= РЕДКО;
  if (!пораСобытия && !пораРасход) return;
  inflight = true;
  try {
    const [events, devHist, tb] = await Promise.all([
      пораСобытия ? loadEventsRange(cfg.url, cfg.token, 50) : Promise.resolve(extras.events),
      /* Двух суток статусов хватает: длиннее окна «остаток стоит» всё равно нет,
         а 2000 точек — это неделя и полсекунды разбора. */
      пораСобытия ? loadDeviceStatusRange(cfg.url, cfg.token, 600) : Promise.resolve(extras.devHist),
      пораРасход ? loadTreatmentsRange(cfg.url, cfg.token, 90) : Promise.resolve(tbКеш),
    ]);
    if (пораСобытия) времяСобытий = now;
    if (пораРасход) { времяРасхода = now; tbКеш = tb; }
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
