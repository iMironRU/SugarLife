/* Версия/сборка приложения и обновление.
   Три слоя обновления:
   • Веб/PWA — service worker: проверка + перезагрузка на свежую оболочку (checkWebUpdate).
   • Нативный OTA (Capgo) — обновление JS-бандла БЕЗ переустановки (checkOtaUpdate),
     самохостинг манифеста+zip на GitHub Pages. Покрывает 99% правок (JS/CSS/HTML).
   • Нативный APK — полная переустановка из GitHub Releases (checkNativeUpdate + openApkDownload),
     нужна лишь при смене нативного кода/зависимостей.
   iOS-нативка через APK обновляться не может (только App Store), но OTA работает и на iOS. */
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'

const REPO = 'iMironRU/SugarLife';
const ANDROID_TAG = 'android-latest';
// Самохостинг OTA-бандла на GitHub Pages (канонический домен, без редиректа
// с *.github.io — важно для нативного HTTP-загрузчика Capgo).
const OTA_BASE = 'https://imiron.ru/SugarLife/v2/ota';

export type UpdateResult = 'updated' | 'current' | 'error';

// Подтвердить Capgo, что бандл ожил (иначе откат к предыдущему). No-op в вебе.
export async function notifyAppReady(): Promise<void> {
  if (!isNative) return;
  try { await CapacitorUpdater.notifyAppReady(); } catch { /* ignore */ }
}

export type OtaResult = 'updated' | 'current' | 'error';

// Нативный OTA: сверяем build из манифеста на Pages с текущим; если новее —
// скачиваем zip-бандл, переключаемся на него и перезагружаем webview.
export async function checkOtaUpdate(): Promise<OtaResult> {
  if (!isNative) return 'error';
  try {
    const r = await fetch(`${OTA_BASE}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return 'error';
    const m = await r.json() as { build?: string; version?: string; url?: string };
    const short = (m.build || '').slice(0, 7);
    if (!short || !m.url) return 'error';
    if (APP_BUILD !== 'dev' && short === APP_BUILD) return 'current';
    const bundle = await CapacitorUpdater.download({ url: m.url, version: m.version || short });
    await CapacitorUpdater.set(bundle); // сделать активным
    await CapacitorUpdater.reload();    // перезагрузить webview на новый бандл
    return 'updated';
  } catch {
    return 'error';
  }
}

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

/* Выпускается ли сейчас APK. Пока false — автосборка выключена (SugarLife#133):
   движок подключается composite-сборкой по локальному пути, и на раннере она падает.

   Проверка обновления держится на инварианте «релиз android-latest = последний main»,
   поэтому «SHA отличается» и означало «новее». Инвариант сломался вместе со сборкой:
   релиз замер на 30 июля, и любая установленная сборка новее его. Кнопка «Скачать
   APK» предлагала бы откат — то есть ровно то, чего человек от неё не ждёт.

   Прячем целиком, а не подписываем дату: подпись под кнопкой читают не все, а
   устанавливают её нажатием. Вернуть — одной строкой, когда закроется #133. */
export const ВЫПУСКАЕТСЯ_APK = false;

// Проверить нативный слой (Android): есть ли в релизе android-latest более
// свежий APK, чем установленный. Релиз всегда отражает последний main, поэтому
// «SHA отличается» == «новее» (история движется только вперёд).
export async function checkNativeUpdate(): Promise<NativeUpdateInfo | 'error'> {
  if (!ВЫПУСКАЕТСЯ_APK) return { hasUpdate: false, build: null, apkUrl: null, publishedAt: null };
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
