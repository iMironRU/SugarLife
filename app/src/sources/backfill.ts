/* Фоновая докачка истории глюкозы и лечения в локальную БД (до 90 дней). */
import { useSyncExternalStore } from 'react';
import { getCfg, loadEntriesWindow, loadTreatmentsWindow } from './nightscout';
import {
  putEntries, newestT, oldestT, pruneBefore,
  putTreatments, newestTreatmentT, oldestTreatmentT, pruneTreatmentsBefore,
} from './db';

const DAY = 86400e3;

// Статус фоновой докачки — чтобы UI честно предупреждал, что данные ещё пополняются.
let running = false;
let runningT = false;
const subs = new Set<() => void>();
function emit() { for (const f of subs) f(); }
function setRunning(v: boolean) { if (v !== running) { running = v; emit(); } }
function setRunningT(v: boolean) { if (v !== runningT) { runningT = v; emit(); } }
export function isBackfilling(): boolean { return running || runningT; }
export function subscribeBackfill(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
export function useBackfilling(): boolean { return useSyncExternalStore(subscribeBackfill, isBackfilling, isBackfilling); }

export async function backfill(targetDays = 90) {
  if (running) return;
  const cfg = getCfg();
  if (!cfg || !cfg.enabled || !cfg.url) return;
  setRunning(true);
  try {
    const now = Date.now();
    const minT = now - targetDays * DAY;

    // 1) свежий хвост: от newest в БД (или -2 дня) до сейчас
    const newest = await newestT();
    const gapFrom = newest ? newest + 1 : now - 2 * DAY;
    if (gapFrom < now) {
      await putEntries(await loadEntriesWindow(cfg.url, cfg.token, gapFrom, now + 60000));
    }

    // 2) назад чанками по 7 дней от oldest в БД до targetDays
    let to = (await oldestT()) ?? now;
    while (to > minT) {
      const from = Math.max(minT, to - 7 * DAY);
      await putEntries(await loadEntriesWindow(cfg.url, cfg.token, from, to));
      to = from;
      await new Promise((r) => setTimeout(r, 150)); // не долбим сервер
    }

    await pruneBefore(minT - DAY);
  } catch {
    // тихо — графики покажут, что успели набрать
  } finally {
    setRunning(false);
  }
}

// То же для лечения (temp basal + болюсы/углеводы): один раз копим 90 дней,
// дальше докачивается только хвост. Metrics считает углеводы/инсулин из БД.
export async function backfillTreatments(targetDays = 90) {
  if (runningT) return;
  const cfg = getCfg();
  if (!cfg || !cfg.enabled || !cfg.url) return;
  setRunningT(true);
  try {
    const now = Date.now();
    const minT = now - targetDays * DAY;

    // 1) свежий хвост
    const newest = await newestTreatmentT();
    const gapFrom = newest ? newest + 1 : now - 2 * DAY;
    if (gapFrom < now) {
      await putTreatments(await loadTreatmentsWindow(cfg.url, cfg.token, gapFrom, now + 60000));
    }

    // 2) назад чанками по 7 дней
    let to = (await oldestTreatmentT()) ?? now;
    while (to > minT) {
      const from = Math.max(minT, to - 7 * DAY);
      await putTreatments(await loadTreatmentsWindow(cfg.url, cfg.token, from, to));
      to = from;
      await new Promise((r) => setTimeout(r, 150));
    }

    await pruneTreatmentsBefore(minT - DAY);
  } catch {
    // тихо
  } finally {
    setRunningT(false);
  }
}
