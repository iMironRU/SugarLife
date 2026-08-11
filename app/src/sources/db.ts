/* Локальная БД глюкозы (IndexedDB) — накапливаем историю до 90 дней,
   чтобы графики за длинные периоды не были пустыми. */
import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { Entry, Treatment } from './nightscout';
import { compressPlateaus } from '@/domain/battery';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB('sugarlife', 3, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 't' });
        // лечение: ключ [t, type] — как дедуп в сторе (temp basal по циклам, болюсы/углеводы)
        if (!d.objectStoreNames.contains('treatments')) d.createObjectStore('treatments', { keyPath: ['t', 'type'] });
        /* Заряд помпы во времени. Отдельным хранилищем и только ПЕРЕХОДЫ значения,
           а не каждый замер: смысл несёт момент, когда процент изменился, а замеров
           приходит по одному в минуту. За девяносто дней это сотни строк вместо
           сотен тысяч — и только так можно накопить историю, которой в облаке уже
           не достать: там за один запрос доступны последние часы. */
        if (!d.objectStoreNames.contains('battery')) d.createObjectStore('battery', { keyPath: 't' });
      },
    });
  }
  return dbp;
}

/* Подписка на изменения БД (для перезапроса графиков). Счётчик версии тут был, но
   читать его стало некому — подписчики просто перезапрашивают данные, — и он
   молча увеличивался в никуда. */
const listeners = new Set<() => void>();
export function onDbChange(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function bump() { for (const l of listeners) l(); }

/* Записываем, но будим подписчиков только если что-то действительно изменилось.

   Опрос идёт раз в минуту, плюс сокет — на деле refresh срабатывает каждые ~17 с,
   и каждый раз в базу писались одни и те же последние 288 записей. Сама запись
   дешёвая, а вот bump() поднимал ВСЕХ подписчиков перечитывать своё окно: «Метрики»
   с периодом 90 дней — это 127 тысяч записей и треть секунды. Отсюда и рывки на
   ровном месте, причём на любом экране.

   Считаем размер до и после: ключ — время, поэтому повторная запись тех же точек
   размер не меняет. Счёт по хранилищу идёт по индексу и стоит доли миллисекунды. */
export async function putEntries(entries: Entry[]) {
  if (!entries.length) return;
  const d = await db();
  const было = await d.count('entries');
  const tx = d.transaction('entries', 'readwrite');
  for (const e of entries) tx.store.put(e);
  await tx.done;
  if (await d.count('entries') !== было) bump();
}

// entries с t >= since, отсортированы по времени (keyPath = t)
export async function getSince(since: number): Promise<Entry[]> {
  const d = await db();
  return (await d.getAll('entries', IDBKeyRange.lowerBound(since))) as Entry[];
}

export async function newestT(): Promise<number | null> {
  const d = await db();
  const cur = await d.transaction('entries').store.openCursor(null, 'prev');
  return cur ? (cur.key as number) : null;
}
export async function oldestT(): Promise<number | null> {
  const d = await db();
  const cur = await d.transaction('entries').store.openCursor(null, 'next');
  return cur ? (cur.key as number) : null;
}
export async function countEntries(): Promise<number> {
  const d = await db();
  return d.count('entries');
}

export async function pruneBefore(before: number) {
  const d = await db();
  const tx = d.transaction('entries', 'readwrite');
  let cur = await tx.store.openCursor(IDBKeyRange.upperBound(before, true));
  while (cur) { await cur.delete(); cur = await cur.continue(); }
  await tx.done;
}

/* Хук с признаком «ещё читаю».

   Пустой массив означает две разные вещи: «в базе нет ничего» и «чтение не
   закончилось». Экран разбора на этом и спотыкался: пока читались две недели
   истории, он успевал показать вердикт «данных пока мало» — то есть неверный вывод
   вместо ожидания. */
export function useHistory(
  windowMs: number,
  { paused = false, minRefreshMs = 0 }: ReadOpts = {},
): { entries: Entry[]; loading: boolean } {
  const [state, setState] = useState<{ entries: Entry[]; loading: boolean }>({ entries: [], loading: true });
  useEffect(() => {
    let cancel = false;
    let последний = 0;
    setState((s) => ({ ...s, loading: true }));
    const load = (принудительно = false) => {
      /* Перечитывать две недели на каждую новую точку — дорого и незачем. Сенсор
         пишет раз в минуту, а чтение 19 740 записей стоит около 70 мс: на открытом
         экране это ровно те рывки, которые видно. Кому нужна свежесть по минутам —
         не зовёт с minRefreshMs. */
      if (!принудительно && minRefreshMs && Date.now() - последний < minRefreshMs) return;
      последний = Date.now();
      getSince(Date.now() - windowMs)
        .then((e) => { if (!cancel) setState({ entries: e, loading: false }); })
        .catch(() => { if (!cancel) setState((s) => ({ ...s, loading: false })); });
    };
    if (!paused) load(true);
    const off = onDbChange(() => { if (!paused) load(); });
    return () => { cancel = true; off(); };
  }, [windowMs, minRefreshMs, paused]);
  return state;
}


/* Общие опции хуков чтения.

   paused — экран не виден. Все пять вкладок смонтированы разом (иначе не работал бы
   свайп между ними), и невидимые продолжали перечитывать базу на каждое изменение.
   Самый дорогой случай: «Метрики» с периодом 90 дней читают 127 тысяч записей за
   330 мс — и делают это, пока человек смотрит на «Сегодня». Это и были рывки.

   minRefreshMs — не чаще, чем раз в. Для длинных окон перечитывать на каждую новую
   точку бессмысленно: сенсор пишет раз в минуту, а выводы за две недели от одной
   точки не меняются. */
export interface ReadOpts { paused?: boolean; minRefreshMs?: number }

// Хук: entries из БД за окно windowMs, с перезапросом при обновлениях/докачке.
export function useEntries(windowMs: number, { paused = false, minRefreshMs = 0 }: ReadOpts = {}): Entry[] {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    let cancel = false;
    let последний = 0;
    const load = (принудительно = false) => {
      if (!принудительно && minRefreshMs && Date.now() - последний < minRefreshMs) return;
      последний = Date.now();
      getSince(Date.now() - windowMs).then((e) => { if (!cancel) setEntries(e); }).catch(() => {});
    };
    /* Грузим только когда экран виден. Первая версия звала load(true) безусловно —
       и уход с вкладки сам запускал самое дорогое чтение: эффект перезапускался от
       смены paused. Получилось ровно наоборот задуманному. */
    if (!paused) load(true);
    const off = onDbChange(() => { if (!paused) load(); });
    return () => { cancel = true; off(); };
  }, [windowMs, paused, minRefreshMs]);
  return entries;
}

// --- лечение (treatments): temp basal + болюсы/углеводы, копим до 90 дней ---
// то же для лечения: повторная запись тех же событий не должна будить экраны
export async function putTreatments(ts: Treatment[]) {
  if (!ts.length) return;
  const d = await db();
  const было = await d.count('treatments');
  const tx = d.transaction('treatments', 'readwrite');
  for (const t of ts) tx.store.put(t);
  await tx.done;
  if (await d.count('treatments') === было) return;
  bump();
}
export async function getTreatmentsSince(since: number): Promise<Treatment[]> {
  const d = await db();
  return (await d.getAll('treatments', IDBKeyRange.lowerBound([since]))) as Treatment[];
}
export async function newestTreatmentT(): Promise<number | null> {
  const d = await db();
  const cur = await d.transaction('treatments').store.openCursor(null, 'prev');
  return cur ? (cur.key as [number, string])[0] : null;
}
export async function oldestTreatmentT(): Promise<number | null> {
  const d = await db();
  const cur = await d.transaction('treatments').store.openCursor(null, 'next');
  return cur ? (cur.key as [number, string])[0] : null;
}
export async function pruneTreatmentsBefore(before: number) {
  const d = await db();
  const tx = d.transaction('treatments', 'readwrite');
  let cur = await tx.store.openCursor(IDBKeyRange.upperBound([before], true));
  while (cur) { await cur.delete(); cur = await cur.continue(); }
  await tx.done;
}

// Хук: лечение из БД за окно windowMs, с перезапросом при докачке.
export function useTreatments(windowMs: number, { paused = false, minRefreshMs = 0 }: ReadOpts = {}): Treatment[] {
  const [ts, setTs] = useState<Treatment[]>([]);
  useEffect(() => {
    let cancel = false;
    let последний = 0;
    // тот же ограничитель, что у истории: на экране разбора перечитывать нечему помогать
    const load = (принудительно = false) => {
      if (!принудительно && minRefreshMs && Date.now() - последний < minRefreshMs) return;
      последний = Date.now();
      getTreatmentsSince(Date.now() - windowMs).then((t) => { if (!cancel) setTs(t); }).catch(() => {});
    };
    if (!paused) load(true);
    const off = onDbChange(() => { if (!paused) load(); });
    return () => { cancel = true; off(); };
  }, [windowMs, paused, minRefreshMs]);
  return ts;
}


/* --- Заряд помпы: накопление истории переходов ---

   Зачем вообще хранить. Вопрос «сколько ещё проработает» отвечается только собственной
   историей человека, а её негде взять: Nightscout за разумный запрос отдаёт последние
   часы, и одного цикла разряда там не увидеть. Значит копим сами — по крупицам, из тех
   же данных, которые и так грузим.

   Храним края плато, а не каждый замер: сжатие живёт в домене (compressPlateaus) —
   там же, где считается смысл, и там же покрыто тестом. */
export async function putBatteryPoints(points: { t: number; pct: number }[]) {
  if (!points.length) return;
  const d = await db();
  const было = await d.getAll('battery') as { t: number; pct: number }[];
  const стало = compressPlateaus([...было, ...points]);
  if (стало.length === было.length && стало.every((x, i) => было[i]?.t === x.t)) return;

  const tx = d.transaction('battery', 'readwrite');
  await tx.store.clear();
  for (const p of стало) tx.store.put(p);
  await tx.done;
  bump();
}

export async function getBatteryPoints(): Promise<{ t: number; pct: number }[]> {
  const d = await db();
  return (await d.getAll('battery')) as { t: number; pct: number }[];
}
