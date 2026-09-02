import type { SourceStatus } from '@/sources/bridge';

/* Как этот статус называется человеку — в `слова/приборы.ts` (#324). Здесь остаётся суждение:
   тревожный статус или нет, — оно про поведение, а не про буквы. */

/** Тревожный ли статус — им красим строку, а не рисуем отдельную иконку. */
export function sourceStatusWarn(s: SourceStatus | undefined | null): boolean {
  /* ReadOnTouch сюда не входит намеренно: тревожный вид у нормального состояния
     обесценивает тревожный вид вообще. */
  return s === 'Delayed' || s === 'Disconnected';
}
