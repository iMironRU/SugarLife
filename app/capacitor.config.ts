import type { CapacitorConfig } from '@capacitor/cli';

// ИЗДАНИЕ (core#61, #296): lite — только чтение, pro — ещё и управление помпой.
// Берётся из окружения, чтобы издания разъезжались СБОРКОЙ: в репозитории общие файлы одинаковы для обоих,
// и «переименовать приложение коммитом» больше не требуется.
const EDITION = process.env.SUGARLIFE_EDITION === 'pro' ? 'pro' : 'lite';

const config: CapacitorConfig = {
  appId: EDITION === 'pro' ? 'ru.imiron.sugarlife.pro' : 'ru.imiron.sugarlife',
  appName: EDITION === 'pro' ? 'SugarLife.Pro' : 'SugarLife.Lite',
  webDir: 'dist',
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
