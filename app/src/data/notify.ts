/* Локальные уведомления (без сервера, без push): натив сам показывает через ОС.
   Работает, только пока приложение живо/недавно активно — честно не обещаем
   доставку, когда приложение полностью закрыто надолго (см. память проекта). */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

let permissionAsked = false;
let nextId = 1000;

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

// Показать уведомление сейчас. Тихо ничего не делает в браузере/без разрешения.
export async function notify(title: string, body: string): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id: nextId++, title, body }] });
  } catch { /* ignore */ }
}

// Спросить разрешение сразу при старте — не ждать первого реального события,
// чтобы пользователь явно увидел и решил, а не гадал, почему уведомлений нет.
export function requestNotifyPermissionOnStart(): void {
  void ensurePermission();
}
