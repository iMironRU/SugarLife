/* Фоновая докачка истории глюкозы в локальную БД (до 90 дней). */
import { getCfg, loadEntriesWindow } from './nightscout';
import { putEntries, newestT, oldestT, pruneBefore } from './db';

const DAY = 86400e3;
let running = false;

export async function backfill(targetDays = 90) {
  if (running) return;
  const cfg = getCfg();
  if (!cfg || !cfg.enabled || !cfg.url) return;
  running = true;
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
    running = false;
  }
}
