/* Полный сброс локальных данных. Единый список ключей живёт ЗДЕСЬ: раньше сброс был
   расписан вручную в Profile.tsx и отставал от жизни — реестр устройств и флаг
   онбординга он не чистил, и после «сбросить настройки» приложение открывалось
   с прежними моделями помпы/сенсора и мимо мастера. */

// Всё, что приложение хранит локально. Добавил новый ключ — добавь и сюда.
export const STORAGE_KEYS = [
  'sl.clouds.v1',       // облачные источники (адреса/токены)
  'sl.ns.cfg',          // legacy-конфиг одиночного Nightscout (источник миграции)
  'sl.ns.cache.v1',     // кэш последних данных
  'sl.extras.cache.v1', // кэш расширенных данных устройства
  'sl.device.v1',       // реестр устройств: модели, мосты, инсулин
  'sl.onboarded.v1',    // пройден ли мастер первого запуска
  'sl.loop.v1',         // профиль петли: режим и лимиты
  'sl.justUpdated.v1',  // техфлаг «только что обновились», живёт до первого показа
] as const;

// Настройки отображения — переживают сброс данных намеренно: это про удобство,
// а не про «чьё это устройство». Тема/единицы не раскрывают ничего о человеке.
export const KEPT_KEYS = ['sl.theme', 'sl.units', 'sl.carbunits', 'sl.install.v1'] as const;

export function resetLocalData(): void {
  for (const k of STORAGE_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
  try { indexedDB.deleteDatabase('sugarlife'); } catch { /* ignore */ }
}

/* Самопроверка (только в разработке). Список ключей уже дважды отставал от жизни:
   сначала забыли реестр устройств и флаг онбординга, потом профиль петли. Теперь
   приложение само скажет, что появился ключ, не учтённый ни в одном списке. */
if (import.meta.env.DEV) {
  try {
    const known = new Set<string>([...STORAGE_KEYS, ...KEPT_KEYS]);
    const stray = Object.keys(localStorage).filter((k) => k.startsWith('sl.') && !known.has(k));
    if (stray.length) {
      console.warn('[reset] ключи не учтены в data/reset.ts — сброс их не тронет:', stray);
    }
  } catch { /* ignore */ }
}
