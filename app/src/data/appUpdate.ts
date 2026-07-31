/* Версия/сборка приложения и обновление.
   Два слоя обновления:
   • Веб/PWA — service worker: проверка + перезагрузка на свежую оболочку (checkWebUpdate).
   • Нативный Android — новый APK из GitHub Releases (checkNativeUpdate + openApkDownload).
   iOS-нативка самообновляться не может (только App Store). */
import { Capacitor } from '@capacitor/core';

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'

const REPO = 'iMironRU/SugarLife';
const ANDROID_TAG = 'android-latest';

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

export interface NativeUpdateInfo {
  hasUpdate: boolean;
  build: string | null;      // короткий SHA свежей сборки
  apkUrl: string | null;     // прямая ссылка на .apk
  publishedAt: string | null;
}

// Проверить нативный слой (Android): есть ли в релизе android-latest более
// свежий APK, чем установленный. Релиз всегда отражает последний main, поэтому
// «SHA отличается» == «новее» (история движется только вперёд).
export async function checkNativeUpdate(): Promise<NativeUpdateInfo | 'error'> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${ANDROID_TAG}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return 'error';
    const rel = await r.json();
    const apk = (rel.assets || []).find((a: { name?: string }) => a.name?.toLowerCase().endsWith('.apk'));
    const m = /build:\s*([0-9a-f]{7,40})/i.exec(rel.body || '');
    const short = m ? m[1].slice(0, 7) : null;
    const hasUpdate = !!short && APP_BUILD !== 'dev' && short !== APP_BUILD;
    return {
      hasUpdate,
      build: short,
      apkUrl: apk?.browser_download_url || null,
      publishedAt: rel.published_at || null,
    };
  } catch {
    return 'error';
  }
}

// Открыть скачивание APK во внешнем браузере — Android скачает файл, дальше
// пользователь подтверждает установку системным установщиком пакетов.
export function openApkDownload(url: string): void {
  window.open(url, '_system');
}
