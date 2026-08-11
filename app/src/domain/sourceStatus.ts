import type { SourceStatus } from '@/sources/bridge';

/* Статус источника данных по-русски (контракт 1.7).

   Это жизненный цикл ПОЛУЧЕНИЯ данных, а не состояние связи. Разница не формальная:
   сенсор может быть подключён и при этом ещё ничего не отдавать — идёт прогрев или
   первый обмен. Раньше такое состояние выглядело как «подключено», и человек ждал
   цифру, которой ещё неоткуда взяться.

   «Отстаёт» тоже отдельно от «нет связи»: связь есть, показания идут, но последнее
   старше четверти часа. Для ночи это разные новости. */
export function sourceStatusLabel(s: SourceStatus | undefined | null): string | null {
  switch (s) {
    case 'Live': return 'на связи';
    case 'Acquiring': return 'связь есть, показаний ещё нет';
    case 'Connecting': return 'подключается';
    case 'Delayed': return 'отстаёт';
    case 'Disconnected': return 'нет связи';
    default: return null; // мост поля не прислал — не выдумываем
  }
}

/** Тревожный ли статус — им красим строку, а не рисуем отдельную иконку. */
export function sourceStatusWarn(s: SourceStatus | undefined | null): boolean {
  return s === 'Delayed' || s === 'Disconnected';
}
