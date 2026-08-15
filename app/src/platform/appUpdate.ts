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

/* Как называется то, что стоит у человека (SugarLife#235).

   Приложений будет два, и различаются они не набором кнопок, а границей ответственности:
   Lite показывает и подсказывает, Pro управляет подачей инсулина. Это разные приложения
   для разных людей и разного риска, и стоять на телефоне они могут одновременно.

   Поэтому имя издания нужно там, где человек читает «что у меня стоит»: на иконке (чтобы
   не перепутать два ярлыка) и в «О приложении» (чтобы в сообщении о проблеме была не одна
   версия, а версия чего). Русский логотип на заставке остаётся: внутри приложения путать
   не с чем. */
export const APP_EDITION = 'SugarLife.Lite';
export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;
export const APP_BUILT_AT = __APP_BUILT_AT__;

/* Новее ли релиз того, что установлено. Вынесено отдельно и с тестом, потому что
   ошибиться здесь легко и незаметно: `new Date(undefined)` даёт NaN, а любое сравнение
   с NaN — false. При молчащем API это и есть правильный ответ («не предлагать»), но
   получиться он должен намеренно, а не по случайности приведения типов. */
export function новееЛи(релиз?: string | null, собрано?: string | null): boolean {
  if (!релиз || !собрано) return false;
  const а = Date.parse(релиз); const б = Date.parse(собрано);
  if (Number.isNaN(а) || Number.isNaN(б)) return false;
  return а > б;
}
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

/* Выпускается ли сейчас APK (SugarLife#238).

   Было false, пока APK не выпускался вовсе: автосборка выключена (#133 — движок
   подключается composite-сборкой по локальному пути, и на раннере она падает), релиз
   замер на 30 июля, и кнопка предлагала бы откат на сборку старше установленной.

   Теперь APK собирается руками и выкладывается в тот же релиз, поэтому кнопка нужна.
   Но вернуть один флаг было мало: старая проверка сравнивала SHA на «не равно», а это
   утверждение «другой», а не «новее». Пока релиз шёл из CI следом за main, разницы не
   было; при ручной выкладке релиз отстаёт от main регулярно — и предложение обновиться
   означало бы откат. Поэтому ниже сравнивается ещё и время. */
export const ВЫПУСКАЕТСЯ_APK = true;

/* Проверить нативный слой (Android): есть ли в релизе android-latest сборка НОВЕЕ
   установленной.

   Два условия, и второе важнее первого. SHA отвечает только на «тот же или другой» —
   этого хватает, чтобы не предлагать обновление на самого себя. А «новее» знает лишь
   время: когда выложен файл против того, когда собран бандл.

   Сравнение с бандлом, а не с APK, выбрано намеренно. После OTA внутри установленного
   APK живёт более свежий JS, и мерить надо именно его: иначе человеку, который только
   что обновился по воздуху, снова предложат качать десять мегабайт ради того же кода. */
/* ЧТО СТОИТ НАТИВНО — отдельный вопрос от «какой у нас JS» (SugarLife#238).

   Сравнивать релиз с бандлом было бы неверно ровно в том случае, ради которого кнопка и
   нужна. Обычный порядок такой: выкладываем APK и OTA-бандл из одного коммита; человек
   жмёт «Обновиться», OTA привозит свежий JS — и с этой минуты бандл совпадает с релизом,
   хотя APK у него старый. Кнопка не появилась бы никогда, а нативные правки (имя
   приложения, плагины, версия) так и остались бы прошлыми.

   Узнаём через Capgo: пока активен «встроенный» бандл, JS и APK — из одной сборки, и
   это единственный момент, когда сборку APK вообще можно узнать изнутри. Запоминаем её
   тогда же; дальше OTA меняет бандл, а запись остаётся. */
const КЛЮЧ_НАТИВНОЙ = 'sl.native.v1';

export interface НативнаяСборка { build: string; builtAt: string }

export function нативнаяСборка(): НативнаяСборка | null {
  try {
    const s = localStorage.getItem(КЛЮЧ_НАТИВНОЙ);
    if (!s) return null;
    const о = JSON.parse(s);
    return typeof о?.build === 'string' && typeof о?.builtAt === 'string' ? о : null;
  } catch { return null; }
}

export async function запомнитьНативнуюСборку(): Promise<void> {
  if (!isNative) return;
  try {
    const с = await CapacitorUpdater.current();
    /* 'builtin' — тот бандл, что приехал внутри APK. Любое другое имя означает, что
       поверх уже лёг OTA, и текущий JS про APK ничего не говорит. */
    if (с?.bundle?.version !== 'builtin') return;
    localStorage.setItem(КЛЮЧ_НАТИВНОЙ, JSON.stringify({ build: APP_BUILD, builtAt: APP_BUILT_AT }));
  } catch { /* приватный режим, старый плагин — тогда сравним по бандлу, как раньше */ }
}

export async function checkNativeUpdate(): Promise<NativeUpdateInfo | 'error'> {
  if (!ВЫПУСКАЕТСЯ_APK) return { hasUpdate: false, build: null, apkUrl: null, publishedAt: null };
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${ANDROID_TAG}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return 'error';
    const rel = await r.json();
    const apk = (rel.assets || []).find(
      (a: { name?: string }) => a.name?.toLowerCase().endsWith('.apk'),
    ) as { name?: string; browser_download_url?: string; updated_at?: string } | undefined;
    const m = /build:\s*([0-9a-f]{7,40})/i.exec(rel.body || '');
    const short = m ? m[1].slice(0, 7) : null;
    /* Когда появился ИМЕННО ЭТОТ файл, а не когда завели релиз. Тег android-latest один
       и живёт вечно: перезалили файл — `published_at` остался прежним, и по нему свежая
       сборка выглядит июльской. У приложения дата берётся из файла, поэтому и здесь
       спрашиваем файл. */
    const выложено = apk?.updated_at || rel.published_at;
    /* Сравниваем с нативной сборкой, если знаем её. Не знаем — с бандлом: так вело себя
       приложение раньше, и это честнее, чем молчать. Разойтись эти ответы могут только
       на телефоне, где APK поставили до появления записи. */
    const своё = нативнаяСборка() ?? { build: APP_BUILD, builtAt: APP_BUILT_AT };
    const hasUpdate = !!short && своё.build !== 'dev' && short !== своё.build
      && новееЛи(выложено, своё.builtAt);
    return {
      hasUpdate,
      build: short,
      apkUrl: apk?.browser_download_url || null,
      publishedAt: выложено || null,
    };
  } catch {
    return 'error';
  }
}

/* Установка обновления в одно нажатие (SugarLife#269).

   Нативный плагин качает файл сам и отдаёт его системному установщику. Человеку
   остаётся одно подтверждение вместо четырёх шагов: открылся браузер, скачалось, найди
   в «Загрузках», открой.

   Тихой установки это не даёт и дать не может: право заменить пакет без диалога Android
   выдаёт только владельцу устройства. Поэтому и в тексте кнопки ничего про «само» не
   обещаем.

   Плагина нет — падаем на прежний путь через браузер: старая сборка, которую как раз и
   обновляют, о новом плагине не знает. */
export async function installApk(url: string): Promise<'начали' | 'нет плагина' | 'ошибка'> {
  const плагин = (Capacitor as unknown as {
    Plugins?: { ApkUpdater?: { install(o: { url: string }): Promise<void> } };
  }).Plugins?.ApkUpdater ?? (window as unknown as {
    Capacitor?: { Plugins?: { ApkUpdater?: { install(o: { url: string }): Promise<void> } } };
  }).Capacitor?.Plugins?.ApkUpdater;
  if (!плагин) return 'нет плагина';
  try { await плагин.install({ url }); return 'начали'; } catch { return 'ошибка'; }
}

// Открыть скачивание APK во внешнем браузере — Android скачает файл, дальше
// пользователь подтверждает установку системным установщиком пакетов.
export function openApkDownload(url: string): void {
  window.open(url, '_system');
}
