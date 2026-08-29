import { registerPlugin, Capacitor } from '@capacitor/core';
import { уНатива } from './уНатива';

/* Отдавать показания в петлю — выключатель (#419, core#100, #413).

   ЧТО ЭТО ВООБЩЕ ТАКОЕ. Петля (AAPS, iAPS) считает дозы по показаниям сенсора. Наши
   показания она принять может, но только если мы их отдадим. До сих пор механизм был, а
   способа его включить не было: сделать это можно было правкой настроек через adb, то есть
   с компьютера и отладочной сборкой. Для человека это не способ.

   ЭТО ВСЕГДА ВЫБОР ЧЕЛОВЕКА, И ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ. Отдача наружу — не наша инициатива:
   по нашим числам чужая программа посчитает инсулин. Пока человек не сказал «да», не уходит
   ничего.

   ПОЧЕМУ РАЗНЫЕ МЕХАНИЗМЫ. На Android показания уходят адресным вещанием — только AAPS, а
   не всем подряд. На iOS вещания между приложениями нет: там общий контейнер, который iAPS
   опрашивает раз в десять секунд. Разные дороги, один выключатель. */
interface Плагин {
  aapsBroadcast(): Promise<{ enabled: boolean }>;
  setAapsBroadcast(o: { enabled: boolean }): Promise<{ enabled: boolean }>;
  loopFeed(): Promise<{ enabled: boolean; container?: string | null; problem?: string | null }>;
  setLoopFeed(o: { enabled: boolean }): Promise<{ enabled: boolean; problem?: string | null }>;
}
const Native = registerPlugin<Плагин>('SugarLifeBridge');

export interface ОтдачаВПетлю {
  включено: boolean;
  /** Кому именно уходит — словами, для экрана. */
  кому: string;
  /* Что мешает отдавать прямо сейчас. null — всё на месте.

     Это не то же самое, что «выключено»: человек может включить отдачу и не получить её —
     на iOS общий контейнер требует одинаковой подписи у обеих программ. Молчать об этом
     нельзя: он будет ждать, что петля увидит его сахар, а она не увидит. */
  мешает: string | null;
}

export const отдачаВозможна = (): boolean =>
  Capacitor.isNativePlatform() && (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios');

const ЭТО_IOS = () => Capacitor.getPlatform() === 'ios';

export async function отдача(): Promise<ОтдачаВПетлю | null> {
  if (!отдачаВозможна()) return null;
  /* Запасное — null, а НЕ «выключено»: сказать «выключено» значит обещать выключатель, которого
     в этой сборке нет. */
  return уНатива('loopFeed', async () => {
    if (ЭТО_IOS()) {
      const r = await Native.loopFeed();
      return { включено: !!r.enabled, кому: 'iAPS — через общий контейнер', мешает: r.problem ?? null };
    }
    const r = await Native.aapsBroadcast();
    return { включено: !!r.enabled, кому: 'AAPS — адресным вещанием', мешает: null };
  }, null);
}

export async function задатьОтдачу(включить: boolean): Promise<{ ок: boolean; мешает: string | null }> {
  if (!отдачаВозможна()) return { ок: false, мешает: null };
  return уНатива<{ ок: boolean; мешает: string | null }>('setLoopFeed', async () => {
    if (ЭТО_IOS()) {
      const r = await Native.setLoopFeed({ enabled: включить });
      return { ок: true, мешает: r.problem ?? null };
    }
    await Native.setAapsBroadcast({ enabled: включить });
    return { ок: true, мешает: null };
  }, { ок: false, мешает: null });
}

/* ЧТО ИМЕННО УХОДИТ — списком, а не «показания».

   Человек, отдающий свои числа чужой программе, вправе знать состав до того, как нажмёт, а
   не после. Список короткий и полный: больше этого не уходит ничего — ни еды, ни доз, ни
   истории. */
export const ЧТО_УХОДИТ = [
  'калиброванное значение сахара',
  'сырое значение — отдельным полем, чтобы получатель хранил оба',
  'тренд и время показания',
  'когда начат сенсор',
];
