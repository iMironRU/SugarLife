import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.imiron.sugarlife',
  appName: 'SugarLife',
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
