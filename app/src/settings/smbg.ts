import { useSyncExternalStore } from 'react';
import { прочитатьJson, записатьJson } from './storage';

/* Показания глюкометра, внесённые руками.

   Отдельно от истории НМГ — и это принципиально, а не техническая мелочь.

   Сенсор меряет в межклеточной жидкости раз в минуту-пять, и весь разбор построен на
   этой равномерности: время в диапазоне, GMI, пропуски, вариабельность. Показание с
   пальца — это другое измерение, точнее по крови и реже по времени. Подмешать его в
   ленту сенсора значит испортить обе величины разом: и «пропусков нет» (потому что
   точка есть), и «в диапазоне» (потому что вес у одной точки с пальца получится тот
   же, что у пяти минут сенсора).

   Поэтому храним рядом и показываем рядом. Это не хуже — это честнее: проверка с
   пальца отвечает на вопрос «сенсор не врёт?», а на него не ответить данными самого
   сенсора.

   Пока только локально. Записать в Nightscout как BG Check мы не можем: записи туда
   в приложении нет вовсе (нужен токен и отдельный путь для медицинских данных), а
   делать вид, что показание ушло в облако, — худшее из возможного. */

const KEY = 'sl.smbg.v1';
const ПРЕДЕЛ = 500; // столько записей хватает с запасом; дальше вытесняем старые

export interface Smbg {
  t: number;
  mmol: number;
  /** Зачем мерили — помогает потом понять, что происходило. */
  reason?: 'calibration' | 'low' | 'high' | 'other';
}

function load(): Smbg[] {
  try {
    const v = прочитатьJson<Smbg[] | null>(KEY, null);
    return Array.isArray(v) ? v.filter((x) => Number.isFinite(x?.t) && Number.isFinite(x?.mmol)) : [];
  } catch { return []; }
}

let state = load();
const subs = new Set<() => void>();
function save() {
  записатьJson(KEY, state);
  subs.forEach((f) => f());
}

function getSmbg(): Smbg[] { return state; }

export function addSmbg(mmol: number, reason?: Smbg['reason'], at = Date.now()): void {
  state = [...state, { t: at, mmol, reason }].sort((a, b) => a.t - b.t).slice(-ПРЕДЕЛ);
  save();
}


export function useSmbg(): Smbg[] {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getSmbg, getSmbg,
  );
}

export const SMBG_REASONS: { id: NonNullable<Smbg['reason']>; name: string }[] = [
  { id: 'calibration', name: 'Проверка сенсора' },
  { id: 'low', name: 'Похоже на гипо' },
  { id: 'high', name: 'Похоже на высокий' },
  { id: 'other', name: 'Просто так' },
];
