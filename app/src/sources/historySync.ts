import { getBridge, queryHistory, type GlucosePoint, type UiSnapshot } from './bridge';
import { newestT, putEntries } from './db';
import { MGDL_PER_MMOL, type Entry } from '@/domain/types';

/* Наполнение локальной истории из моста.

   Наша IndexedDB — единственный источник правды по истории в приложении: по ней
   строится таблица НМГ, графики за сутки и весь разбор за 14–90 дней. Наполнялась она
   до сих пор ТОЛЬКО из Nightscout.

   Это ломается ровно в тот момент, когда появляется сенсор, читаемый напрямую: в круге
   живая цифра, а в истории её нет. Причём ломается молча — разбор просто посчитает по
   дырявым данным и честно напишет «пропуски в CGM 76%». Мы этот сюжет уже проходили,
   когда аналитика считала по последним суткам вместо истории.

   Поэтому историю тянем у моста: у ядра она единая (сенсор + Nightscout + облака),
   и запрос через контракт — единственный способ до неё добраться. */

/* Тянем только глюкозу, а не 'Both'. Лечение в контракте описано одним числом
   `amount` при свободной строке `kind` — по нему нельзя надёжно понять, инсулин это
   или углеводы, а перепутать их в приложении, где считают дозы, недопустимо. Лечение
   продолжаем брать из Nightscout, пока в контракте не появится различимая форма. */
const ПЕРЕКРЫТИЕ_МС = 10 * 60e3; // хвост назад: последняя точка могла прийти неполной
const ПУСТАЯ_БАЗА_МС = 24 * 3600e3; // база пуста — берём сутки, глубину доберёт докачка
const НЕ_ЧАЩЕ_МС = 30e3;

/** Окно запроса: от последнего, что уже лежит, до сейчас. Пустая база — сутки назад. */
export function окноЗапроса(новейшее: number | null, сейчас: number): { fromMs: number; toMs: number } {
  const fromMs = новейшее != null ? новейшее - ПЕРЕКРЫТИЕ_МС : сейчас - ПУСТАЯ_БАЗА_МС;
  return { fromMs, toMs: сейчас };
}

/** GlucosePoint контракта → наше измерение. Точки без значения выбрасываем. */
export function toEntries(points: GlucosePoint[]): Entry[] {
  const out: Entry[] = [];
  for (const p of points) {
    if (p.mmol == null || !Number.isFinite(p.mmol) || !Number.isFinite(p.atMs)) continue;
    out.push({
      t: p.atMs,
      mmol: p.mmol,
      mgdl: Math.round(p.mmol * MGDL_PER_MMOL),
      dir: p.trend ?? '',
    });
  }
  return out;
}

let идёт = false;
let последний = 0;

/** Один проход. Возвращает, сколько точек записали. */
export async function syncHistory(force = false): Promise<number> {
  const сейчас = Date.now();
  if (идёт || (!force && сейчас - последний < НЕ_ЧАЩЕ_МС)) return 0;
  идёт = true;
  последний = сейчас;
  try {
    const окно = окноЗапроса(await newestT(), сейчас);
    const r = await queryHistory({ kind: 'Glucose', ...окно });
    const entries = toEntries(r.glucose);
    if (entries.length) await putEntries(entries);
    return entries.length;
  } catch {
    return 0; // мост может не отвечать — это не повод ломать экран
  } finally {
    идёт = false;
  }
}

/* Когда тянуть.

   Слепой опрос по таймеру тут не нужен: мост и так шлёт снимок, и в нём есть время
   новейшего показания. Если оно новее того, что лежит у нас, — значит появилось что-то,
   чего мы не видели, и только тогда идём за окном.

   Побочный, но важный эффект: пока мост — это шим над Nightscout, наша база уже
   наполнена из того же источника, latestAtMs совпадает с новейшим в базе, и запрос не
   уходит вовсе. То есть в браузере лишней работы не появляется.

   Таймер всё же есть, но редкий и как страховка: снимки могут не приходить (мост
   молчит, приложение вернулось из фона), а дыру закрыть надо. */
const СТРАХОВКА_МС = 5 * 60e3;

export function startHistorySync(): () => void {
  let известное = 0;
  const проверить = (s: UiSnapshot) => {
    const t = s.monitor?.latestAtMs ?? 0;
    if (t > известное) { известное = t; void syncHistory(); }
  };
  const отписка = getBridge().subscribe(проверить);
  const таймер = window.setInterval(() => { void syncHistory(); }, СТРАХОВКА_МС);
  void syncHistory(true);
  return () => { отписка(); window.clearInterval(таймер); };
}
