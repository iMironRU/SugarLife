import { useSyncExternalStore } from 'react';
import { прочитать, записать, прочитатьJson, записатьJson } from './storage';

/* Замены расходников, отмеченные в приложении.

   Почему это вообще нужно. Возраст канюли, резервуара и датчика мы берём из событий
   Nightscout — и они ненадёжны в обе стороны. Разбор девяноста дней реальных данных:

   • Залипание. С 25 по 30 июля резервуар держал значение 50, хотя картридж заменили
     27-го в 08:50. AAPS не зарегистрировал замену вовсе: ни события, ни скачка. Плитка
     всё это время показывала бы «залит 5 дней» — ошибка на трое суток.
   • Глючные скачки. 50 → 101 — это не долив, а сбой чтения. Поэтому замену по скачку
     значения мы не детектим принципиально: ложное срабатывание тут хуже пропуска.

   Логировать замену в AAPS человеку лень, и это нормально — приложение должно спросить
   само. Отсюда однотапная отметка: она пишется только сюда, локально, и ничего не
   отправляет в Nightscout (права на запись может не быть вовсе).

   Правило разрешения: возраст расходника — САМОЕ СВЕЖЕЕ из отметки и события. Не
   «отметка важнее»: если человек поменял, отметил в приложении, а потом залогировал и
   в AAPS, событие придёт позже — и оно же ближе к правде. */

export type Consumable = 'sensor' | 'site' | 'reservoir' | 'battery';

const KEY = 'sl.changes.v1';
export type Changes = Partial<Record<Consumable, number>>;

function load(): Changes {
  try {
    const v = прочитатьJson<Record<string, number> | null>(KEY, null);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

let state = load();
const subs = new Set<() => void>();
function save() {
  записатьJson(KEY, state);
  subs.forEach((f) => f());
}

export function getChanges(): Changes { return state; }

/** Отметить замену. Без аргумента — сейчас. */
export function markChanged(what: Consumable, at = Date.now()): void {
  state = { ...state, [what]: at };
  save();
}

/** Снять отметку — для «отменить» сразу после случайного тапа. */
export function unmarkChanged(what: Consumable): void {
  const s = { ...state };
  delete s[what];
  state = s;
  save();
}

/* О какой заправке мы уже спрашивали. Без этого вопрос всплывал бы снова и снова:
   заправка остаётся в истории навсегда, а закрыть вопрос человек может один раз.
   Хранится время самой заправки, а не факт «спрашивали»: следующая заправка — это
   новое время, и вопрос появится честно. */
const KEY_ASKED = 'sl.asked.refill.v1';

export function askedRefill(): number {
  return Number(прочитать(KEY_ASKED)) || 0;
}
export function markRefillAsked(at: number): void {
  записать(KEY_ASKED, String(at));
  subs.forEach((f) => f());
}

export function useChanges(): Changes {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getChanges, getChanges,
  );
}

export const CONSUMABLE_LABEL: Record<Consumable, string> = {
  sensor: 'Датчик', site: 'Канюля', reservoir: 'Резервуар', battery: 'Батарейка',
};
