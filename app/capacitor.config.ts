import type { CapacitorConfig } from '@capacitor/cli';

// ИЗДАНИЕ (core#61, #296): lite — только чтение, pro — ещё и управление помпой.
// Берётся из окружения, чтобы издания разъезжались СБОРКОЙ: в репозитории общие файлы одинаковы для обоих,
// и «переименовать приложение коммитом» больше не требуется.
const EDITION = process.env.SUGARLIFE_EDITION === 'pro' ? 'pro' : 'lite';

const config: CapacitorConfig = {
  appId: EDITION === 'pro' ? 'ru.imiron.sugarlife.pro' : 'ru.imiron.sugarlife',
  appName: EDITION === 'pro' ? 'SugarLife.Pro' : 'SugarLife.Lite',
  webDir: 'dist',
  /*
   * ЭХО МОСТА В КОНСОЛЬ УБИВАЛО ПРИЛОЖЕНИЕ (SugarLifeCore#233).
   *
   * По умолчанию `loggingBehavior` = 'debug': Capacitor печатает в консоль каждый вызов плагина
   * вместе с ОТВЕТОМ. Ответ у нас — снимок на 33 КБ, да ещё экранированный.
   *
   * Дальше это идёт не в пустоту: каждый `console.*` переезжает в Java НА ГЛАВНЫЙ ПОТОК, и
   * `BridgeWebChromeClient.onConsoleMessage` сканирует там строку. Замер на телефоне владельца, в
   * покое, без единого касания: 103 сообщения и 402 КБ за полторы минуты.
   *
   * Кончилось это ANR — «приложение не отвечает» на выходе из фона — и смертью процесса, прожившего
   * до того восемнадцать часов. Двое суток мы чинили выживание в фоне, а убивал нас собственный
   * отладочный вывод.
   *
   * Публичных релизов у нас нет, на телефоне живёт отладочная сборка — значит это не «поведение при
   * разработке», а наше поведение в жизни.
   *
   * ЧТО ТЕРЯЕМ: ошибки JS больше не попадают в системный лог. Потеря настоящая, и мы её принимаем:
   * по кабелю всё видно через CDP, а важное и так идёт в журнал движка, а не в консоль.
   */
  loggingBehavior: 'none',
  backgroundColor: '#161826',
  ios: {
    backgroundColor: '#161826',
    // контент во весь экран (как в PWA); верхний отступ даёт CSS env(safe-area-inset-top),
    // иначе с 'always' safe-area складывается дважды и сверху слишком большой зазор
    contentInset: 'never',
  },
  android: {
    backgroundColor: '#161826',
  },
  plugins: {
    // OTA-обновление JS-бандла (Capgo) в РУЧНОМ режиме, самохостинг на GitHub Pages.
    // autoUpdate:false — обновляемся только по кнопке в Профиле (checkOtaUpdate).
    // statsUrl:'' — не звоним на серверы Capgo (офлайн/без облака).
    // resetWhenUpdate:true — при установке нового APK сбрасываем старый OTA-бандл.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      resetWhenUpdate: true,
    },
  },
};

export default config;
