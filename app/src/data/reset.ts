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
