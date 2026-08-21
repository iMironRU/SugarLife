import { registerPlugin, Capacitor } from '@capacitor/core';

/* Живой баннер на экране блокировки, в «Динамическом острове» и в CarPlay (#428).

   ПОЧЕМУ ЭТО НЕ ВИДЖЕТ. Виджет обновляется, когда система сочтёт нужным, — раз в
   пятнадцать минут в лучшем случае. Сахар меняется каждые пять, и виджет, показывающий
   получасовой давности число как текущее, хуже отсутствующего. Live Activity обновляет
   приложение само, в тот момент, когда пришло показание.

   ЧТО ЭТО ДАЁТ ЗА РУЛЁМ. Живой баннер попадает на приборную панель CarPlay тем же
   способом, что на экран блокировки, — отдельного «приложения для машины» для этого не
   нужно, и хорошо: Google и Apple пускают туда только определённые категории, и
   медицинских среди них нет.

   ЧЕГО НЕ ДАЁТ. Обновляется он, пока приложение живо или просыпается от эфира BLE. Через
   восемь часов система гасит баннер сама, через двенадцать — снимает; приложение обязано
   его продлевать. И всё это только на iOS 16.2 и новее. */
interface Плагин {
  liveBanner(): Promise<{ supported: boolean; on: boolean; running: boolean }>;
  setLiveBanner(o: { on: boolean }): Promise<void>;
}
const Native = registerPlugin<Плагин>('SugarLifeBridge');

export interface СостояниеБаннера {
  /** Умеет ли эта система живые уведомления вообще. */
  умеет: boolean;
  включён: boolean;
  /** Висит ли прямо сейчас. Может быть false при включённом — человек смахнул его. */
  идёт: boolean;
}

export const баннерВозможен = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export async function состояниеБаннера(): Promise<СостояниеБаннера | null> {
  if (!баннерВозможен()) return null;
  try {
    const r = await Native.liveBanner();
    return { умеет: !!r.supported, включён: !!r.on, идёт: !!r.running };
  } catch {
    /* Метода нет — сборка старше баннера. Это не «выключено»: молчать нельзя, иначе
       человек решит, что включил, и будет ждать баннера, которого не будет. */
    return null;
  }
}

export async function включитьБаннер(on: boolean): Promise<boolean> {
  if (!баннерВозможен()) return false;
  try { await Native.setLiveBanner({ on }); return true; } catch { return false; }
}
