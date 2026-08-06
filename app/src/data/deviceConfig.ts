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

/* Реестр устройств (docs/CONNECT-UX.md §2a): жизненный цикл записи —
   Записано (модель выбрана) → Настроено (путь подключения полный) → На связи/На паузе → Забыто.
   Честно: «На связи/На паузе» тут не считаем — это про живое BLE-подключение, которого у нас
   пока физически нет (движок — скелет, см. project-bridge-contract). Как появятся реальные
   драйверы — состояние подтянется из snapshot.devices[], а не отсюда. */
export type DeviceStatus = 'unset' | 'recorded' | 'configured';

export function deviceStatus(cat: 'sensor' | 'pump', cfg: DeviceConfig): DeviceStatus {
  if (cat === 'pump') {
    if (!cfg.pumpId) return 'unset';
    return pumpNeedsBridge(pumpById(cfg.pumpId)) && !cfg.bridgePumpId ? 'recorded' : 'configured';
  }
  if (!cfg.sensorId) return 'unset';
  return sensorById(cfg.sensorId)?.needsBridge && !cfg.bridgeSensorId ? 'recorded' : 'configured';
}

export function deviceStatusLabel(status: DeviceStatus): string {
  return status === 'unset' ? 'настроить' : status === 'recorded' ? 'записано — нужен мост' : 'настроено';
}

// «Забыть устройство» (§2a, путь 10) — снять модель и её мост для категории.
export function forgetDevice(cat: 'sensor' | 'pump'): void {
  if (cat === 'pump') setDeviceConfig({ pumpId: null, bridgePumpId: null });
  else setDeviceConfig({ sensorId: null, bridgeSensorId: null });
}
