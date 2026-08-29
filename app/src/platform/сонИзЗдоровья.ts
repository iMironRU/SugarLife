import { registerPlugin, Capacitor } from '@capacitor/core';
import { уНатива } from './уНатива';
import { sendIntent } from '@/sources/bridge';

/* СОН ИЗ ЗДОРОВЬЯ ТЕЛЕФОНА → ДВИЖКУ (#597, ядро #177).

   Читает натив — HealthKit и Health Connect это API платформы. Решает движок: мы шлём наблюдения,
   он выводит окно медианой за две недели, от пяти ночей.

   Своего вывода здесь нет ни строчки, и это не лень. Два расчёта окна — у нас и у них — разошлись
   бы в первую же неделю, и человек увидел бы на одном экране два разных ответа про свой же сон.

   ШЛЁМ ПРИ ИЗМЕНЕНИЯХ, А НЕ ПО ТАЙМЕРУ. Ядро сказало прямо: сессии приезжают задним числом, раз в
   несколько часов. Опрос по расписанию будил бы приложение зря — а живучесть у нас и без того
   больное место. */

interface ПлагинСна {
  sleepSessions(): Promise<{
    available: 'yes' | 'no' | 'denied' | 'unknown';
    sessions: { fromMs: number; toMs: number; source: string }[];
    openSinceMs?: number | null;
    observedAtMs?: number | null;
  }>;
}

const Native = registerPlugin<ПлагинСна>('SugarLifeBridge');

/* Чистая половина — её и проверяем. Битую сессию ядро пропустит молча, но слать её незачем: своё
   мы чистим сами, иначе кривизна доедет до чужого разбора и будет искаться там. */
export function подготовитьСессии(
  сырые: { fromMs: number; toMs: number; source: string }[] | null | undefined,
): { fromMs: number; toMs: number; source: 'watch' | 'phone' | 'human' | 'unknown' }[] {
  return (сырые ?? [])
    .filter((с) => Number.isFinite(с.fromMs) && Number.isFinite(с.toMs) && с.toMs > с.fromMs)
    .map((с) => ({
      fromMs: с.fromMs,
      toMs: с.toMs,
      /* Незнакомый источник — `unknown`, а не выдуманный: доверие к часам и к телефону разное, и
         ошибиться в эту сторону дешевле, чем назвать телефон часами. */
      source: (с.source === 'watch' || с.source === 'phone' || с.source === 'human'
        ? с.source : 'unknown') as 'watch' | 'phone' | 'human' | 'unknown',
    }));
}

/** Прочитать и отдать движку. Возвращает состояние источника — по нему экран объясняет человеку. */
export async function отдатьСонДвижку(): Promise<'yes' | 'no' | 'denied' | 'unknown'> {
  if (!Capacitor.isNativePlatform()) return 'no';
  const ответ = await уНатива('sleepSessions', () => Native.sleepSessions(), null);
  if (!ответ) {
    /* НА ANDROID ИСТОЧНИКА ПОКА НЕТ ВОВСЕ (#677): Health Connect мы не подключали, и сказать
       «данных ещё не приходило» значило бы обещать, что они появятся. Не появятся, пока не
       напишем. Человеку это разные советы: «подождите, наберётся» и «задайте окно сами».

       На iOS то же молчание означает другое — сборка старше метода, — и там «не знаем» верно. */
    return Capacitor.getPlatform() === 'android' ? 'no' : 'unknown';
  }

  void sendIntent({
    type: 'reportSleep',
    sessions: подготовитьСессии(ответ.sessions),
    openSinceMs: ответ.openSinceMs ?? null,
    observedAtMs: ответ.observedAtMs ?? null,
    available: ответ.available ?? 'unknown',
  });
  return ответ.available ?? 'unknown';
}
