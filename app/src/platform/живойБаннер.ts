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

/* СВОДКА В ШТОРКЕ — СОСЕД БАННЕРА, А НЕ ЕГО ЗАМЕНА (#500).

   Баннер живёт на экране блокировки и в машине, но его смахивают, он гаснет через восемь часов и его
   нет на часах. Сводка — обычное тихое уведомление, которое каждое новое показание ЗАМЕНЯЕТ собой:
   одна свежая строка в центре уведомлений, а не лента из двенадцати за час. Она не звенит и не
   заменяет тревогу — это фон.

   Живёт здесь же, рядом с баннером: вопрос у человека один — «что я узнаю, не открывая приложение». */
interface ПлагинСводки {
  statusNote(): Promise<{ on: boolean; pop?: boolean }>;
  setStatusNote(o: { on?: boolean; pop?: boolean }): Promise<{ on: boolean; pop?: boolean }>;
  reportActiveInsulin(o: { iob?: number }): Promise<void>;
}
const NativeСводка = registerPlugin<ПлагинСводки>('SugarLifeBridge');

/** null — платформа не та или сборка старше сводки. */
export async function сводкаВключена(): Promise<boolean | null> {
  if (!баннерВозможен()) return null;
  try { return !!(await NativeСводка.statusNote()).on; } catch { return null; }
}

export async function включитьСводку(on: boolean): Promise<boolean> {
  if (!баннерВозможен()) return false;
  try { await NativeСводка.setStatusNote({ on }); return true; } catch { return false; }
}

/* ВСПЛЫВАТЬ ИЛИ ЛЕЖАТЬ ТИХО (#539). Одна и та же строка, две повадки: показаться поверх экрана,
   как только пришло показание, или молча лечь в центр уведомлений. Выбор человека — «мелькает
   каждые пять минут» это ровно то, ради чего сводку ставят, и ровно то, из-за чего её выключают.

   `false` при старой сборке, а не null: повадка — уточнение к сводке, а не отдельная возможность,
   и переключателю на экране достаточно знать, что всплытия сейчас нет. */
export async function сводкаВсплывает(): Promise<boolean> {
  if (!баннерВозможен()) return false;
  try { return !!(await NativeСводка.statusNote()).pop; } catch { return false; }
}

export async function включитьВсплытие(pop: boolean): Promise<boolean> {
  if (!баннерВозможен()) return false;
  try { await NativeСводка.setStatusNote({ pop }); return true; } catch { return false; }
}

/* АКТИВНЫЙ ИНСУЛИН — НАТИВУ, ДЛЯ СВОДКИ (#500).

   В облачном режиме его считает Nightscout, а не движок: движок отдаёт ноль, и сводка в шторке про
   инсулин молчала бы, хотя на экране число есть. Отдаём его нативу, пока приложение живо; там оно
   хранится со сроком годности — устаревшее не показывается, потому что инсулин расходуется и без нас.

   Неизвестное шлём пустым: «0 ед» и «мы не знаем» — разные ответы, и путать их в шторке нельзя. */
export async function сообщитьИнсулин(iob: number | null): Promise<void> {
  if (!баннерВозможен()) return;
  try { await NativeСводка.reportActiveInsulin(iob == null ? {} : { iob }); } catch { /* сборка старше */ }
}

export async function включитьБаннер(on: boolean): Promise<boolean> {
  if (!баннерВозможен()) return false;
  try { await Native.setLiveBanner({ on }); return true; } catch { return false; }
}
