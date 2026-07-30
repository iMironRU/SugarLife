/* Локальная БД глюкозы (IndexedDB) — накапливаем историю до 90 дней,
   чтобы графики за длинные периоды не были пустыми. */
import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { Entry } from './nightscout';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB('sugarlife', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 't' });
      },
    });
  }
  return dbp;
}

// подписка на изменения БД (для перезапроса графиков)
let version = 0;
const listeners = new Set<() => void>();
export function onDbChange(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function dbVersion() { return version; }
function bump() { version++; for (const l of listeners) l(); }

export async function putEntries(entries: Entry[]) {
  if (!entries.length) return;
  const d = await db();
  const tx = d.transaction('entries', 'readwrite');
  for (const e of entries) tx.store.put(e);
  await tx.done;
  bump();
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

// Хук: entries из БД за окно windowMs, с перезапросом при обновлениях/докачке.
export function useEntries(windowMs: number): Entry[] {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    let cancel = false;
    const load = () => getSince(Date.now() - windowMs).then((e) => { if (!cancel) setEntries(e); }).catch(() => {});
    load();
    const off = onDbChange(load);
    return () => { cancel = true; off(); };
  }, [windowMs]);
  return entries;
}
