/* Сенсорный слой захвата/освобождения BLE-устройств: вибро + сигнал для баннера.
   Разделение слоёв: ЯДРО (движок) — правда (эмитит статусы Connecting/Live/Disconnected по устройству),
   ПРИЛОЖЕНИЕ — ощущения. Здесь диффим статусы между снимками и на переходах даём вибро + событие для UI.
   Только BLE-устройства (облачные ns-* пропускаем — там нет «захвата эфира»). */
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { DeviceInfo } from './bridge';

export type BlePhase = 'capturing' | 'captured' | 'released';
export interface BleEvent { id: string; name: string; phase: BlePhase; at: number; }

let last: BleEvent | null = null;
const subs = new Set<() => void>();

// Нормализуем к «крупной» фазе для сравнения между снимками.
type Coarse = 'off' | 'connecting' | 'acquiring' | 'live';
function coarse(d: DeviceInfo): Coarse {
  const s = (d.status || '').toString();
  if (s === 'Live') return 'live';
  if (s === 'Acquiring') return 'acquiring';
  if (s === 'Connecting') return 'connecting';
  if (s === 'Disconnected') return 'off';
  // Fallback по connection, если ядро не прислало status (старый мост)
  const c = (d.connection || '').toString();
  if (c === 'Streaming' || c === 'Connected') return 'live';
  if (c === 'Connecting') return 'connecting';
  return 'off';
}

// Облачные источники (Nightscout) — не BLE: их реконнект вибрировать не должен.
function isBle(d: DeviceInfo): boolean {
  return !(d.id === 'nightscout' || d.id.startsWith('ns-'));
}

function vibrate(phase: BlePhase): void {
  if (!Capacitor.isNativePlatform()) {
    // Веб-фолбэк (Android-браузер; iOS WKWebView игнорирует) — грубая вибрация паттерном.
    try { navigator.vibrate?.(phase === 'captured' ? [35, 40, 35] : phase === 'released' ? 90 : 18); } catch { /* нет вибро */ }
    return;
  }
  // Нативные хаптики (работают и на iOS): захват — лёгкий тычок, успех/потеря — нотификация.
  try {
    if (phase === 'capturing') void Haptics.impact({ style: ImpactStyle.Light });
    else if (phase === 'captured') void Haptics.notification({ type: NotificationType.Success });
    else void Haptics.notification({ type: NotificationType.Warning });
  } catch { /* плагин недоступен */ }
}

function fire(id: string, name: string, phase: BlePhase): void {
  last = { id, name, phase, at: Date.now() };
  vibrate(phase);
  subs.forEach((f) => f());
}

// Память предыдущей фазы по устройству (seed на первом снимке — без сигнала).
const prev = new Map<string, Coarse>();
let seeded = false;

/** Сопоставить новый снимок устройств с предыдущим → вибро+баннер на переходах захвата/освобождения. */
export function diffBleActivity(devices: DeviceInfo[]): void {
  const ble = devices.filter(isBle);
  if (!seeded) { for (const d of ble) prev.set(d.id, coarse(d)); seeded = true; return; }
  for (const d of ble) {
    const now = coarse(d);
    const was = prev.get(d.id) ?? 'off';
    if (now === was) continue;
    prev.set(d.id, now);
    if (was !== 'connecting' && was !== 'acquiring' && was !== 'live' && now === 'connecting') {
      fire(d.id, d.name, 'capturing');            // начался захват (было выключено → подключаемся)
    } else if (now === 'live' && was !== 'live') {
      fire(d.id, d.name, 'captured');             // захвачено — пошли свежие данные
    } else if (now === 'off' && (was === 'live' || was === 'acquiring' || was === 'connecting')) {
      fire(d.id, d.name, 'released');             // освобождено/связь потеряна
    }
  }
}

export function useBleActivity(): BleEvent | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => last,
  );
}
