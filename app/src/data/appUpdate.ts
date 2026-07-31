/* Версия/сборка приложения и обновление веб-слоя (PWA/OTA).
   Слой 1 (внутрянка/веб): здесь — проверка service worker + перезагрузка на свежую.
   Слой 2 (нативный APK): будет добавлен через Capgo + проверку релиза (нужна нативка). */
import { Capacitor } from '@capacitor/core';

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;
export const isNative = Capacitor.isNativePlatform();

export type UpdateResult = 'updated' | 'current' | 'error';

// Проверить веб-слой: если есть свежая версия — применить и перезагрузиться.
export async function checkWebUpdate(): Promise<UpdateResult> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { location.reload(); return 'updated'; }
    await reg.update();
    if (reg.installing || reg.waiting) {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      // дать SW активироваться, затем перезагрузка
      window.setTimeout(() => location.reload(), 400);
      return 'updated';
    }
    return 'current';
  } catch {
    return 'error';
  }
}
