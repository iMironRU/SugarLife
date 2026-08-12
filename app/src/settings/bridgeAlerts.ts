import { useSyncExternalStore } from 'react';
import { прочитатьJson, записатьJson } from './storage';
import { notify } from '@/platform/notify';

/* Предупреждение о разряде моста.

   Это настройка ПРИЛОЖЕНИЯ, а не железа, и так решено с ядром: от движка нужен только
   процент, а порог и то, дёргать ли человека, — наше дело. Правильно: в железе нет
   понятия «когда меня беспокоить», это свойство человека и его дня.

   Зачем вообще. Мост питается своей батарейкой, и когда она садится, помпа просто
   перестаёт отвечать. Снаружи это выглядит как поломка помпы или сенсора, и человек
   ищет неисправность там, где её нет. Одно предупреждение заранее экономит вечер.

   Предупреждаем ОДИН раз на разряд, а не при каждом обновлении: иначе двадцать
   одинаковых уведомлений за час научат смахивать их не читая. Сбрасываем, когда мост
   зарядили — то есть когда процент заметно вырос. */

const KEY = 'sl.bridgealert.v1';

export interface BridgeAlertCfg {
  on: boolean;
  /** Процент, ниже которого предупреждаем. */
  threshold: number;
  /** При каком проценте уже предупредили — чтобы не повторяться. */
  firedAt: number | null;
}

const DEFAULT: BridgeAlertCfg = { on: true, threshold: 20, firedAt: null };

function load(): BridgeAlertCfg {
  try {
    const v = прочитатьJson<Partial<BridgeAlertCfg> | null>(KEY, null);
    return v && typeof v === 'object' ? { ...DEFAULT, ...v } : DEFAULT;
  } catch { return DEFAULT; }
}

let state = load();
const subs = new Set<() => void>();
function save() {
  записатьJson(KEY, state);
  subs.forEach((f) => f());
}

export function getBridgeAlert(): BridgeAlertCfg { return state; }
export function setBridgeAlert(patch: Partial<BridgeAlertCfg>): void {
  state = { ...state, ...patch };
  save();
}
export function useBridgeAlert(): BridgeAlertCfg {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getBridgeAlert, getBridgeAlert,
  );
}

/** Заряд вырос настолько, что это точно замена батарейки, а не дрожание шкалы. */
const ЗАРЯДИЛИ = 25;

/** Проверить заряд моста и предупредить, если пора. Вызывать на каждый снимок. */
export function checkBridgeBattery(pct: number | null | undefined): void {
  if (pct == null || !Number.isFinite(pct)) return;
  const { on, threshold, firedAt } = state;

  // Батарейку поменяли — снимаем «уже предупредили», иначе следующий разряд пройдёт молча
  if (firedAt != null && pct - firedAt >= ЗАРЯДИЛИ) { setBridgeAlert({ firedAt: null }); return; }
  if (!on || pct > threshold || firedAt != null) return;

  setBridgeAlert({ firedAt: pct });
  void notify(
    'Мост скоро сядет',
    `Заряд ${pct}%. Когда мост выключится, помпа просто перестанет отвечать — это выглядит как её поломка, но дело в батарейке.`,
  );
}
