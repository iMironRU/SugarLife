/* Выбор устройства/инсулина пользователем. Хранится ТОЛЬКО локально (localStorage) —
   в Nightscout этого нет и писать некуда. v1: помпа + один быстрый инсулин.
   На будущее сюда добавятся режим (помпа/МДИ), базальный инсулин, мульти-профиль. */
import { useSyncExternalStore } from 'react';
import { pumpById, sensorById, pumpNeedsBridge } from './catalog';

const KEY = 'sl.device.v1';

export interface DeviceConfig {
  pumpId: string | null;
  fastInsulinId: string | null;
  sensorId: string | null;
  meterModel: string | null;      // глюкометр: пока свободный текст (справочника нет)
  bridgeSensorId: string | null;  // трансмиттер/мост сенсора
  bridgePumpId: string | null;    // радио-мост помпы (RileyLink и т.п.)
}
const DEFAULT: DeviceConfig = {
  pumpId: null, fastInsulinId: null, sensorId: null, meterModel: null,
  bridgeSensorId: null, bridgePumpId: null,
};

function load(): DeviceConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v ? { ...DEFAULT, ...v } : DEFAULT;
  } catch { return DEFAULT; }
}

let state = load();
const subs = new Set<() => void>();

export function getDeviceConfig(): DeviceConfig { return state; }
export function setDeviceConfig(patch: Partial<DeviceConfig>): void {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export function useDeviceConfig(): DeviceConfig {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getDeviceConfig, getDeviceConfig,
  );
}

/* Модель неизвестна (§2b): запись в реестре ЕСТЬ, а какая это железка — не знаем.
   Такое бывает штатно: человек подключил Nightscout, данные идут, а модель он не назвал.
   Отличать от null обязательно — это два разных состояния:
     null      — записи нет вообще (устройства у человека нет / не заводил)
     UNKNOWN   — запись есть, модель не указана
     <id>      — запись есть, модель известна
   Практическое следствие: пока модель неизвестна, мы не можем знать, нужен ли этой железке
   мост или она вещает напрямую → единственный честный способ для неё — облако. */
export const UNKNOWN_MODEL = 'unknown';

export const isRecorded = (id: string | null): boolean => id != null;
export const isModelKnown = (id: string | null): boolean => id != null && id !== UNKNOWN_MODEL;

/* Реестр устройств (docs/CONNECT-UX.md §2a): жизненный цикл записи —
   Записано → Настроено (путь подключения полный) → На связи/На паузе → Забыто.
   Честно: «На связи/На паузе» тут не считаем — это про живое BLE-подключение, которого у нас
   пока физически нет (движок — скелет, см. project-bridge-contract). Как появятся реальные
   драйверы — состояние подтянется из snapshot.devices[], а не отсюда. */
export type DeviceStatus = 'unset' | 'unknownModel' | 'needsBridge' | 'configured';

export function deviceStatus(cat: 'sensor' | 'pump', cfg: DeviceConfig): DeviceStatus {
  const id = cat === 'pump' ? cfg.pumpId : cfg.sensorId;
  if (!isRecorded(id)) return 'unset';
  if (!isModelKnown(id)) return 'unknownModel';
  if (cat === 'pump') return pumpNeedsBridge(pumpById(id)) && !cfg.bridgePumpId ? 'needsBridge' : 'configured';
  return sensorById(id)?.needsBridge && !cfg.bridgeSensorId ? 'needsBridge' : 'configured';
}

export function deviceStatusLabel(status: DeviceStatus): string {
  switch (status) {
    case 'unset': return 'настроить';
    case 'unknownModel': return 'только через облако';
    case 'needsBridge': return 'записано — нужен мост';
    case 'configured': return 'настроено';
  }
}

// Записать устройство, не зная модели (онбординг: облако отдаёт данные, модель — потом).
export function recordUnknownDevice(cat: 'sensor' | 'pump'): void {
  setDeviceConfig(cat === 'pump' ? { pumpId: UNKNOWN_MODEL } : { sensorId: UNKNOWN_MODEL });
}

// «Забыть устройство» (§2a, путь 10) — снять модель и её мост для категории.
export function forgetDevice(cat: 'sensor' | 'pump'): void {
  if (cat === 'pump') setDeviceConfig({ pumpId: null, bridgePumpId: null });
  else setDeviceConfig({ sensorId: null, bridgeSensorId: null });
}
