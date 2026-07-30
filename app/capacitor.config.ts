import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.imiron.sugarlife',
  appName: 'SugarLife',
  webDir: 'dist',
  backgroundColor: '#161826',
  ios: {
    backgroundColor: '#161826',
    contentInset: 'always',
  },
  android: {
    backgroundColor: '#161826',
  },
};

export default config;
