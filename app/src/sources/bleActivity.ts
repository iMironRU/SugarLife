import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { DeviceView } from './bridge';
import { вДневник } from './дневникStore';

/* Ощущение подключения: вибро и лента событий.

   Разделение слоёв здесь важнее самого кода. Правда о состоянии — у движка: он эмитит
   статусы по каждому устройству. Ощущения — у приложения: мы сравниваем снимки и на
   переходах даём отклик. Движок не должен знать про вибро, а мы не должны угадывать
   состояние — только замечать, что оно изменилось.

   Зачем вообще. При запуске непонятно, что подключается и подключилось ли: экран
   выглядит одинаково и когда сенсор ищется, и когда он молчит. А отклик пальцем
   работает там, где человек на экран не смотрит вовсе — телефон в кармане, сенсор
   поймался, и это надо знать не глядя.

   Три перехода, три разных ощущения:
   • захват начался — лёгкий тычок, «пошло»;
   • захвачено, данные идут — успех;
   • отпустили или потеряли — предупреждение. Оно ощутимо иначе намеренно: потеря
     связи ночью это то, что человек должен заметить, даже не просыпаясь полностью. */

export type BlePhase = 'capturing' | 'captured' | 'released';
export interface BleEvent { id: string; name: string; phase: BlePhase; at: number }

const ПАМЯТЬ = 6; // сколько событий держим в ленте

let лента: BleEvent[] = [];
const subs = new Set<() => void>();

/* Крупная фаза: статусы у ядра подробнее, чем нужно для отклика. Connecting и
   Acquiring — это «идёт», и вибрировать между ними дважды незачем. */
type Фаза = 'off' | 'connecting' | 'acquiring' | 'live';

function фаза(d: DeviceView): Фаза {
  switch (d.status) {
    case 'Live': return 'live';
    case 'Acquiring': return 'acquiring';
    case 'Connecting': return 'connecting';
    case 'Disconnected': return 'off';
    default: break;
  }
  /* Старый мост статуса не присылает — падаем на живой линк. Это фолбэк, а не
     основной путь: connection не различает «подключено» и «уже отдаёт данные». */
  if (d.connection === 'Streaming' || d.connection === 'Connected') return 'live';
  if (d.connection === 'Connecting') return 'connecting';
  return 'off';
}

/* Облачные источники — не BLE: у Nightscout нет «захвата эфира», и вибрировать на его
   переподключение значит дёргать человека каждый раз, когда моргнул интернет. */
const этоBle = (d: DeviceView) => !(d.id === 'nightscout' || d.id.startsWith('ns-'));

function вибро(phase: BlePhase): void {
  if (!Capacitor.isNativePlatform()) {
    // Веб-запасной вариант. На iPhone не сработает — WKWebView вибрацию игнорирует.
    try { navigator.vibrate?.(phase === 'captured' ? [35, 40, 35] : phase === 'released' ? 90 : 18); }
    catch { /* вибро нет — не беда */ }
    return;
  }
  try {
    if (phase === 'capturing') void Haptics.impact({ style: ImpactStyle.Light });
    else if (phase === 'captured') void Haptics.notification({ type: NotificationType.Success });
    else void Haptics.notification({ type: NotificationType.Warning });
  } catch { /* плагина нет в сборке */ }
}

function записать(id: string, name: string, phase: BlePhase): void {
  const событие: BleEvent = { id, name, phase, at: Date.now() };
  лента = [событие, ...лента].slice(0, ПАМЯТЬ);
  /* И в дневник — теми же словами, что на экране (#396). Лента живёт минуты и шесть
     записей, а вопрос «когда сенсор отвалился» человек задаёт назавтра. Пишем ЗДЕСЬ, в
     одной точке с показом: любая другая точка однажды разойдётся с экраном, и в истории
     появится событие, которого человек не видел, — или пропадёт то, которое видел.

     «Подключаюсь…» в дневник не идёт: это не событие, а обещание. В истории строка
     «подключаюсь к сенсору» без ответа читается как «так и не подключился». */
  if (phase !== 'capturing') вДневник('прибор', фразаСобытия(событие));
  вибро(phase);
  subs.forEach((f) => f());
}

/* Какой отклик даёт переход. Отдельной чистой функцией — не ради красоты: сам дифф
   держит состояние между снимками и завязан на вибро, его в тестах не подержать. А вот
   правило «что считать событием» проверить нужно: именно в нём живут «дёргает на каждый
   чих» и «молчит, когда связь потеряна». */
export function переход(прежде: Фаза, стало: Фаза): BlePhase | null {
  if (стало === прежде) return null;
  if (прежде === 'off' && стало === 'connecting') return 'capturing';
  if (стало === 'live') return 'captured';
  if (стало === 'off') return 'released';
  /* Connecting → Acquiring и обратно откликом не считаем: для человека это одно и то же
     «идёт», а два тычка подряд читаются как сбой, а не как прогресс. */
  return null;
}

export type { Фаза };

const было = new Map<string, Фаза>();
let первыйСнимок = true;

/* Первый снимок только запоминаем. Иначе при каждом открытии приложения человек
   получал бы «подключено» на всё, что и так было подключено, — а это ровно тот шум,
   от которого перестают замечать настоящие события. */
export function diffBleActivity(devices: DeviceView[]): void {
  const ble = devices.filter(этоBle);
  if (первыйСнимок) {
    for (const d of ble) было.set(d.id, фаза(d));
    первыйСнимок = false;
    return;
  }
  for (const d of ble) {
    const стало = фаза(d);
    const прежде = было.get(d.id) ?? 'off';
    if (стало === прежде) continue;
    было.set(d.id, стало);

    const ph = переход(прежде, стало);
    if (ph) записать(d.id, d.name, ph);
  }
}

export function useBleActivity(): BleEvent[] {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => лента, () => лента,
  );
}

export const фразаСобытия = (e: BleEvent): string =>
  e.phase === 'capturing' ? `Подключаюсь к «${e.name}»…`
  : e.phase === 'captured' ? `«${e.name}» на связи`
  : `«${e.name}» отключился`;
