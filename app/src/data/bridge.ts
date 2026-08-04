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
}
export type Trend =
  | 'RisingRapidly' | 'Rising' | 'RisingSlowly' | 'Stable'
  | 'FallingSlowly' | 'Falling' | 'FallingRapidly' | 'Unknown' | '—';
export type Link = 'Disconnected' | 'Connecting' | 'Connected' | 'Streaming' | 'Error';

export type ParamType = 'Text' | 'Secret' | 'Number' | 'Bool' | 'Enum';
export interface Param { key: string; title: string; type: ParamType; required: boolean; default: string | null; options: string[]; }
export interface SettingsSpec { parameters: Param[]; }
export interface DeviceInfo {
  id: string; name: string; kind: 'sensor' | 'pump' | 'service';
  roles: string[]; connection: Link | string;
  capabilities: Record<string, string>;
  settings: SettingsSpec;
  admittedInput: boolean; admittedOutput: boolean; testable: boolean;
}
export interface Insights { mode: 'Observe' | 'Advisory' | 'ClosedLoop'; messages: string[]; }
export interface PendingWrite { id: string; description: string; state: string; needsAttention: boolean; }
export interface Alert { level: 'info' | 'warn' | 'critical'; text: string; }
export interface UiSnapshot {
  bridgeRevision: string;
  monitor: Monitor;
  devices: DeviceInfo[];
  insights: Insights | null;
  pendingWrites: PendingWrite[];
  alerts: Alert[];
}

// ---- История (rev ≥ 1.1): query(HistoryQuery) → HistoryResult ----
export interface HistoryQuery { kind: 'Glucose' | 'Treatments' | 'Both'; fromMs: number; toMs: number; maxPoints?: number | null; }
export interface GlucosePoint { atMs: number; mmol: number | null; source: string; trend?: string | null; }
export interface TreatmentPoint { atMs: number; kind: string; amount: number; evidence: string; source: string; }
export interface HistoryResult { glucose: GlucosePoint[]; treatments: TreatmentPoint[]; }

// ---- Intent (веб → натив) ----
export type Intent =
  | { type: 'addDevice'; driverType: string; params: Record<string, string> }
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
  | { type: 'setAlgorithmParams'; params: Record<string, string> };

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
