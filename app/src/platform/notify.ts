/* Локальные уведомления (без сервера, без push): натив сам показывает через ОС.
   Работает, только пока приложение живо/недавно активно — честно не обещаем
   доставку, когда приложение полностью закрыто надолго (см. память проекта). */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { податьЦель } from '@/показ/цельПерехода';

let permissionAsked = false;
let nextId = 1000;

/* ТАП ПО НАШЕМУ УВЕДОМЛЕНИЮ ВЕДЁТ ТУДА, О ЧЁМ ОНО (#473, тем же путём, что тревоги в #524).

   У тревог это уже есть: натив кладёт цель в уведомление, `цельПерехода` её принимает, а
   `ПереходПоЦели` открывает раздел. Локальные уведомления веб-слоя мимо этого шли — открывали
   приложение там, где человек был в прошлый раз.

   Для вечернего вопроса это не мелочь: он ровно про то, что надо зайти и починить. Уведомление,
   которое говорит «может не разбудить» и высаживает на экран «Сегодня», заставляет искать раздел
   руками — вечером, когда человек уже ложится и легко решит, что разберётся завтра.

   Подписываемся один раз и лениво: слушатель нужен, только если уведомления вообще шлём. */
let слушаемТапы = false;
function слушатьТапы(): void {
  if (слушаемТапы || !Capacitor.isNativePlatform()) return;
  слушаемТапы = true;
  void LocalNotifications.addListener('localNotificationActionPerformed', (е) => {
    const цель = (е.notification?.extra as { цель?: string } | undefined)?.цель;
    if (цель) податьЦель(цель);
  }).catch(() => { слушаемТапы = false; });
}

async function ensurePermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false; // веб-браузер — no-op
  try {
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === 'granted') return true;
    if (permissionAsked) return false; // не спамим повторными запросами
    permissionAsked = true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch { return false; }
}

/**
 * Показать уведомление сейчас. Тихо ничего не делает в браузере/без разрешения.
 *
 * `цель` — куда вести по нажатию («охрана», «помпа», «сенсор»…). Без неё поведение прежнее:
 * приложение откроется там, где человек был.
 */
export async function notify(title: string, body: string, цель?: string): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;
  if (цель) слушатьТапы();
  try {
    await LocalNotifications.schedule({
      notifications: [{ id: nextId++, title, body, ...(цель ? { extra: { цель } } : {}) }],
    });
  } catch { /* ignore */ }
}

// Спросить разрешение сразу при старте — не ждать первого реального события,
// чтобы пользователь явно увидел и решил, а не гадал, почему уведомлений нет.
export function requestNotifyPermissionOnStart(): void {
  void ensurePermission();
}
