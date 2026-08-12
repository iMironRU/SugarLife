import { useSyncExternalStore } from 'react';
import { прочитатьJson, записатьJson } from './storage';
import { убратьЛишние, показывать, type Отложения } from '@/domain/snooze';

/* Отложенные подсветки — хранение. Правило живёт в domain/snooze.ts.

   Локально, и в движок не поедет (см. таблицу в settings/storage.ts): «я это уже
   видел и сейчас не могу» — состояние головы человека в этот час, а не настройка,
   которую стоит восстанавливать на новом телефоне. Переустановил приложение —
   пусть увидит заново: это дешевле, чем молчать о разрядке из-за решения,
   принятого месяц назад на другом устройстве. */

const KEY = 'sl.snooze.v1';

let state: Отложения = прочитатьJson<Отложения>(KEY, {});
const subs = new Set<() => void>();

function save(next: Отложения) {
  state = next;
  записатьJson(KEY, state);
  subs.forEach((f) => f());
}

export function useОтложения(): Отложения {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => state, () => state,
  );
}

/** Отложить подсветку до смены эпизода или ухудшения. */
export function отложить(ключ: string, эпизод: string, уровень: number): void {
  save({ ...state, [ключ]: { эпизод, уровень } });
}

/* Уборка при заходе на экран: отложения, чей эпизод уже сменился, ни на что не
   влияют. Передаём живые эпизоды тех подсветок, которые сейчас посчитаны. */
export function прибрать(живые: Record<string, string>): void {
  const next = убратьЛишние(state, живые);
  if (Object.keys(next).length !== Object.keys(state).length) save(next);
}

export { показывать };
