import { прочитатьJson, записатьJson } from './storage';
/* Выбор устройства/инсулина пользователем. Хранится ТОЛЬКО локально (localStorage) —
   в Nightscout этого нет и писать некуда. v1: помпа + один быстрый инсулин.
   На будущее сюда добавятся режим (помпа/МДИ), базальный инсулин, мульти-профиль. */
import { useSyncExternalStore } from 'react';
import { pumpById, sensorById, pumpNeedsBridge } from '@/domain/catalog';
import type { BatteryKind } from '@/domain/battery';

const KEY = 'sl.device.v1';

export interface DeviceConfig {
  pumpId: string | null;
  fastInsulinId: string | null;
  sensorId: string | null;
  meterModel: string | null;      // глюкометр: пока свободный текст (справочника нет)
  bridgeSensorId: string | null;  // трансмиттер/мост сенсора
  bridgePumpId: string | null;    // радио-мост помпы (RileyLink и т.п.)
  /* Параметры драйвера по категориям: {'pump': {serial, region}}.
     По контракту это `setParams` в ядро, но нативного моста в браузере нет — до его
     появления держим у себя (спеки — domain/driverParams.ts). Секретов здесь быть НЕ
     ДОЛЖНО: пароли от чужих облаков в браузер не кладём вовсе (SugarLifeCore#3). */
  deviceParams: Record<string, Record<string, string>>;
  /* Химия батарейки помпы. Нужна не для красоты: процент заряда сам по себе не
     говорит, сколько осталось, — у литиевой кривая разряда почти плоская до конца,
     у алкалиновой падает раньше, у аккумулятора помпа занижает процент с начала.
     Прогноз строим по собственной истории человека (domain/battery.ts), а тип
     объясняет, почему у соседа те же 20% значат другое. */
  pumpBatteryKind: BatteryKind | null;
}
const DEFAULT: DeviceConfig = {
  pumpId: null, fastInsulinId: null, sensorId: null, meterModel: null,
  bridgeSensorId: null, bridgePumpId: null, deviceParams: {}, pumpBatteryKind: null,
};

function load(): DeviceConfig {
  try {
    const v = прочитатьJson<Partial<DeviceConfig> | null>(KEY, null);
    return v ? { ...DEFAULT, ...v } : DEFAULT;
  } catch { return DEFAULT; }
}

let state = load();
const subs = new Set<() => void>();

export function getDeviceConfig(): DeviceConfig { return state; }
export function setDeviceConfig(patch: Partial<DeviceConfig>): void {
  state = { ...state, ...patch };
  записатьJson(KEY, state);
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

// «Забыть устройство» (§2a, путь 10) — снять модель, её мост и параметры драйвера.
// Параметры чистим обязательно: серийник помпы относится к конкретной железке, и
// оставить его от забытой — значит подсунуть чужой номер следующей.
export function forgetDevice(cat: 'sensor' | 'pump'): void {
  const params = { ...state.deviceParams };
  delete params[cat];
  if (cat === 'pump') setDeviceConfig({ pumpId: null, bridgePumpId: null, deviceParams: params });
  else setDeviceConfig({ sensorId: null, bridgeSensorId: null, deviceParams: params });
}

/** Параметры драйвера категории (пустой объект, если ничего не задано). */
export function getParams(cat: string): Record<string, string> {
  return state.deviceParams[cat] ?? {};
}
export function setParam(cat: string, key: string, value: string): void {
  const cur = state.deviceParams[cat] ?? {};
  setDeviceConfig({ deviceParams: { ...state.deviceParams, [cat]: { ...cur, [key]: value } } });
}
