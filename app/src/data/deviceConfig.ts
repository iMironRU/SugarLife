/* Выбор устройства/инсулина пользователем. Хранится ТОЛЬКО локально (localStorage) —
   в Nightscout этого нет и писать некуда. v1: помпа + один быстрый инсулин.
   На будущее сюда добавятся режим (помпа/МДИ), базальный инсулин, мульти-профиль. */
import { useSyncExternalStore } from 'react';

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
