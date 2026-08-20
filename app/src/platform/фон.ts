/* Переживёт ли приложение уход с экрана — вопрос к платформе, не к движку (#380).

   В режиме Doze система игнорирует замки бодрствования и приостанавливает сеть всем,
   кроме приложений из списка исключений. То есть выключенный экран может означать не
   «мониторинг спит», а «мониторинг выключен», и узнаёт человек об этом задним числом —
   по дырке в ленте показаний.

   СЛОВА ЖИВУТ В ЯДРЕ, а не здесь. Вопрос один и тот же на двух платформах и у двух
   изданий, и ответ должен быть один: разные слова на один вопрос — это два разных
   ответа. Отсюда уходит только запрос, обратно приходит готовое: проблема ли это, что
   происходит, что делать и можем ли мы открыть нужный экран сами. */
import { registerPlugin, Capacitor } from '@capacitor/core';

export interface ФонОтвет {
  /** Выдано ли системное исключение из оптимизации батареи. */
  ignoring: boolean;
  manufacturer: string;
  /** Есть ли о чём говорить. false — экран готовности молчит. */
  problem: boolean;
  reason: string;
  whatToDo: string;
  /* Открыть системный экран исключений мы можем, вендорский «Запуск приложений» — нет,
     никаким API. Обещать кнопку, которая никуда не ведёт, хуже, чем показать путь
     текстом: человек нажмёт, попадёт не туда и решит, что сделал. */
  weCanOpenSettings: boolean;
}

interface Плагин {
  batteryOptimization(): Promise<ФонОтвет>;
  requestBatteryExemption(): Promise<{ opened: 'dialog' | 'settings' }>;
}
const Native = registerPlugin<Плагин>('SugarLifeBridge');

/* null — «спросить не у кого»: браузер, iOS или сборка старше этих методов. Это НЕ
   «всё в порядке», и путать их нельзя: молчание про фон читается как обещание, что в
   фоне всё работает, а мы этого не знаем. */
export async function фонГотовность(): Promise<ФонОтвет | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await Native.batteryOptimization();
  } catch {
    return null;
  }
}

/** Показать системную просьбу. Зовётся только когда weCanOpenSettings. */
export async function попроситьИсключение(): Promise<boolean> {
  try {
    await Native.requestBatteryExemption();
    return true;
  } catch {
    return false;
  }
}
