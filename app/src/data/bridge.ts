/* Контракт интеграции PWA ↔ система (см. документ). PWA — представление: читает
   UiSnapshot через мост и шлёт Intent. Мост — либо нативный (window.SugarLifeBridge,
   ставит оболочка/релей), либо наш Nightscout-шим (bridgeNightscout) в браузере.
   ВАЖНО: sendIntent подтверждает только ПРИЁМ действия, не выполнение. */
import { useEffect, useState } from 'react';
import { nightscoutBridge } from './bridgeNightscout';

// ---- UiSnapshot ----
export interface Monitor {
  glucose: string; glucoseMmol: number | null; trend: Trend; link: Link;
  reservoir: string; battery: string;
  confirmedIOB: number; assumedIOB: number; conservativeIOB: number;
  // rev ≥ 1.7: основной источник отдаёт свежее (true) или идёт синхронизация/бэкфилл (false).
  // false → показываем индикатор «синхронизация», алгоритм эти данные пока не берёт.
  live?: boolean;
}
export type Trend =
  | 'RisingRapidly' | 'Rising' | 'RisingSlowly' | 'Stable'
  | 'FallingSlowly' | 'Falling' | 'FallingRapidly' | 'Unknown' | '—';
export type Link = 'Disconnected' | 'Connecting' | 'Connected' | 'Streaming' | 'Error';

export type ParamType = 'Text' | 'Secret' | 'Number' | 'Bool' | 'Enum';
export interface Param {
  key: string; title: string; type: ParamType; required: boolean; default: string | null; options: string[];
  scan?: 'qr' | null; // rev ≥ 1.5+: поле сканируется камерой (кнопка «Сканировать QR»)
}
export interface SettingsSpec { parameters: Param[]; }

export type SessionState = 'WarmingUp' | 'Active' | 'Expiring' | 'Expired' | 'Stopped' | 'Failed' | 'Unknown';

export interface DeviceInfo {
  id: string; name: string; kind: 'sensor' | 'pump' | 'service';
  roles: string[]; connection: Link | string;
  capabilities: Record<string, string>;
  settings: SettingsSpec;
  admittedInput: boolean; admittedOutput: boolean; testable: boolean;
  // rev ≥ 1.3: мультисенсор — сессия, тайминги, «основной» источник монитора
  sessionState?: SessionState | null;
  warmupEndsAtMs?: number | null;
  expiresAtMs?: number | null;
  primary?: boolean;
  live?: boolean;   // rev ≥ 1.7: отдаёт свежее (true) или идёт синхронизация/бэкфилл (false)
}
export interface Insights { mode: 'Observe' | 'Advisory' | 'ClosedLoop'; messages: string[]; }
export interface PendingWrite { id: string; description: string; state: string; needsAttention: boolean; }

// rev ≥ 1.4: структурная ошибка (RFC 9457) — окно, не баннер
export interface Problem {
  code: string; title: string; remediation: string;
  severity: 'Info' | 'Warn' | 'Error' | 'Critical'; category: 'Ble' | 'Parser' | 'Device' | 'Network' | 'Domain' | 'Internal';
  retryable: boolean; detail?: string | null; errorId?: string | null;
}
export interface Alert { level: 'info' | 'warn' | 'critical'; text: string; problem?: Problem | null }

// rev ≥ 1.4: состояние логирования (раздел «Настройки логирования»)
export interface LoggingState { level: 'Trace' | 'Debug' | 'Info' | 'Warn' | 'Error'; capturingFile: boolean; capturingRaw: boolean; retentionHours: number }

// rev ≥ 1.5: plug-and-play — опознанное при скане устройство
export interface Discovered {
  bleId: string; name: string | null; driverId: string; displayName: string; rssi: number | null;
  needsMoreParams: boolean; isTransport: boolean; transportFor: string[];
}
// rev ≥ 1.2/1.5: каталог типов драйверов, которые умеет ядро
export interface DriverDescriptor {
  id: string; displayName: string; kind: 'sensor' | 'pump' | 'service'; roles: string[];
  settings: SettingsSpec; available: boolean; canActivate?: boolean; providesTransportFor?: string[];
}

export interface UiSnapshot {
  bridgeRevision: string;
  monitor: Monitor;
  devices: DeviceInfo[];
  insights: Insights | null;
  pendingWrites: PendingWrite[];
  alerts: Alert[];
  // rev ≥ 1.5 (опционально — старые мосты/шимы могут не отдавать)
  scanning?: boolean;
  discovered?: Discovered[];
  availableDrivers?: DriverDescriptor[];
  logging?: LoggingState | null;
}

// ---- История (rev ≥ 1.1): query(HistoryQuery) → HistoryResult ----
export interface HistoryQuery { kind: 'Glucose' | 'Treatments' | 'Both'; fromMs: number; toMs: number; maxPoints?: number | null; }
export interface GlucosePoint { atMs: number; mmol: number | null; source: string; trend?: string | null; }
export interface TreatmentPoint { atMs: number; kind: string; amount: number; evidence: string; source: string; }
export interface HistoryResult { glucose: GlucosePoint[]; treatments: TreatmentPoint[]; }

// ---- Intent (веб → натив) ----
export type Intent =
  | { type: 'addDevice'; driverType: string; params: Record<string, string>; mode?: 'attach' | 'activate' }
  | { type: 'connect'; deviceId: string }
  | { type: 'disconnect'; deviceId: string }
  | { type: 'testDevice'; deviceId: string }
  | { type: 'setParams'; deviceId: string; params: Record<string, string> }
  | { type: 'setWiring'; deviceId: string; asInput: boolean; asOutput: boolean }
  | { type: 'startSensor'; deviceId: string }
  | { type: 'readNow'; deviceId: string }
  | { type: 'reconcile'; writeId: string }
  | { type: 'acknowledgeUnknown'; writeId: string; observation: string }
  | { type: 'enableAlgorithm'; enabled: boolean }
  | { type: 'setAlgorithmParams'; params: Record<string, string> }
  // rev ≥ 1.5: plug-and-play скан эфира
  | { type: 'startScan' }
  | { type: 'stopScan' }
  | { type: 'addDiscovered'; bleId: string; driverType: string; params: Record<string, string>; mode?: 'attach' | 'activate'; targetDriver?: string }
  // rev ≥ 1.4: логирование и отправка отчёта об ошибке
  | { type: 'setLogLevel'; level: 'Trace' | 'Debug' | 'Info' | 'Warn' | 'Error' }
  | { type: 'setLogCapture'; file: boolean | null; raw: boolean | null }
  | { type: 'exportLog' }
  | { type: 'sendReport'; errorId: string }
  // rev ≥ 1.6: облачный источник (способ «облако» — Nightscout и подобные), только чтение
  | { type: 'addCloudSource'; url: string; token?: string | null; streams?: Array<'glucose' | 'pump' | 'treatments'> };

export interface SugarLifeBridge {
  bridgeRevision: string;
  subscribe(cb: (s: UiSnapshot) => void): () => void;
  requestSnapshot(): Promise<UiSnapshot>;
  sendIntent(i: Intent): Promise<{ accepted: boolean; error?: string }>;
  // rev ≥ 1.1: окно истории для графиков (опционально — Nightscout-шим может не иметь)
  query?(q: HistoryQuery): Promise<HistoryResult>;
}

// Запрос истории через активный мост (undefined, если мост не поддерживает).
export function queryHistory(q: HistoryQuery): Promise<HistoryResult> | undefined {
  return getBridge().query?.(q);
}

declare global {
  interface Window { SugarLifeBridge?: SugarLifeBridge }
}

const BRIDGE_MAJOR = '1';

// Настоящий мост (оболочка/релей) если совместим по major, иначе Nightscout-шим.
export function getBridge(): SugarLifeBridge {
  const native = typeof window !== 'undefined' ? window.SugarLifeBridge : undefined;
  if (native && String(native.bridgeRevision).split('.')[0] === BRIDGE_MAJOR) return native;
  return nightscoutBridge;
}

// Хук: текущий снимок (null до первого).
export function useSnapshot(): UiSnapshot | null {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  useEffect(() => getBridge().subscribe(setSnap), []);
  return snap;
}

// Отправить действие пользователя. Возвращает лишь факт ПРИЁМА (не выполнения).
export function sendIntent(i: Intent): Promise<{ accepted: boolean; error?: string }> {
  return getBridge().sendIntent(i);
}
