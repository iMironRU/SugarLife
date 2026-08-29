import { registerPlugin, Capacitor } from '@capacitor/core';
import { уНатива } from './уНатива';

/* Кто занял прибор (#422).

   Отобрать чужое подключение нельзя, и узнать точно, кто держит, — тоже: перечислить
   чужие GATT-подключения приложению не дают. Доступны два факта, и вместе они дают
   честный ответ: прибор подключён НА ЭТОМ ТЕЛЕФОНЕ, а данные идут не нам; и на телефоне
   установлено приложение, которое этот прибор умеет.

   Наружу отдаём наблюдение, а не приговор. «Занят Juggluco» мы утверждать не вправе —
   мы этого не знаем; «подключён здесь, но не нами, а рядом стоит Juggluco» — знаем. */
interface Плагин {
  whoHolds(o: { address?: string | null }): Promise<{ busyHere: boolean; candidates: string[] }>;
}
const Native = registerPlugin<Плагин>('SugarLifeBridge');

export interface КтоДержит {
  /** Прибор подключён на этом телефоне — а данных у нас нет. */
  занятЗдесь: boolean;
  /** Знакомые приложения, установленные на телефоне. Не «держит», а «мог бы». */
  кандидаты: string[];
}

export async function ктоДержит(адрес: string | null | undefined): Promise<КтоДержит | null> {
  if (!Capacitor.isNativePlatform()) return null;
  /* Молчим при отказе: выдумывать объяснение молчанию прибора хуже, чем не объяснять его вовсе.
     Но след оставляем — иначе «сборка старше» неотличимо от «никто не держит». */
  return уНатива('whoHolds', async () => {
    const r = await Native.whoHolds({ address: адрес ?? null });
    return { занятЗдесь: !!r.busyHere, кандидаты: Array.isArray(r.candidates) ? r.candidates : [] };
  }, null);
}
