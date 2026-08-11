import { useSyncExternalStore } from 'react';

/* Имена повторяющихся приёмов.

   Имя даётся ПОСТФАКТУМ и необязательно. Причина в принципе проекта: лучший ввод тот,
   которого не было. Каталог-сначала переворачивает его — чтобы внести еду, заведи
   блюдо, — и человек перестаёт вносить вовсе, ровно как перестаёт логировать замену
   канюли в AAPS.

   Поэтому ввод остаётся числом, а имя предлагается позже и ровно один раз: когда
   приём повторился и стал похож на привычный. Отказался — больше не спрашиваем.

   Имя хранится не в самой записи, а отдельно, ключом на ГРУППУ (тип приёма + округлённые
   углеводы). Так его не приходится вписывать задним числом в десяток уже сохранённых
   приёмов, и оно не потеряется, когда старые записи вытеснятся. */

const KEY = 'sl.mealnames.v1';

interface Хранимое {
  /** ключ группы → имя */
  names: Record<string, string>;
  /** группы, для которых человек отказался называть: больше не спрашиваем */
  skipped: string[];
}

function load(): Хранимое {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v === 'object'
      ? { names: v.names ?? {}, skipped: Array.isArray(v.skipped) ? v.skipped : [] }
      : { names: {}, skipped: [] };
  } catch { return { names: {}, skipped: [] }; }
}

let state = load();
const subs = new Set<() => void>();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function getMealNames(): Record<string, string> { return state.names; }
export function isSkipped(groupId: string): boolean { return state.skipped.includes(groupId); }

export function nameGroup(groupId: string, name: string): void {
  const имя = name.trim();
  if (!имя) return;
  state = { ...state, names: { ...state.names, [groupId]: имя } };
  save();
}

export function forgetGroupName(groupId: string): void {
  const names = { ...state.names };
  delete names[groupId];
  state = { ...state, names };
  save();
}

/** Отказ называть — запоминаем, чтобы не переспрашивать. */
export function skipGroup(groupId: string): void {
  if (state.skipped.includes(groupId)) return;
  state = { ...state, skipped: [...state.skipped, groupId] };
  save();
}

export function useMealNames(): Хранимое {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => state, () => state,
  );
}
