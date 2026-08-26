import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const isCap = process.env.CAP === '1' // нативная сборка (Capacitor)
/* Издание сборки (#296). Имя переменной — то же, что читает `capacitor.config.ts`: одно издание, одна
   переменная. Два имени означали бы сборку, где нативная часть называется Pro, а бандл собран как
   Lite, — и молча, потому что оба по отдельности выглядят правильно.

   ПОДСТАВЛЯЕМ значением, а не оставляем чтением: только так ветка «разделы Pro» в Lite становится
   литеральной ложью, и сборщик выбрасывает её вместе со всем кодом управления подачей. Переменные
   окружения оболочки Vite сам в `import.meta.env` не кладёт — только из .env-файлов, поэтому
   подстановка здесь. */
const издание = process.env.SUGARLIFE_EDITION === 'pro' ? 'pro' : 'lite'

// версия из package.json + номер сборки (короткий git SHA)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const build = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' }
})()

// В проде на GitHub Pages приложение живёт по пути /SugarLife/v2/.
// Для нативной сборки (Capacitor, CAP=1) файлы лежат в корне capacitor://localhost/
// → нужен ОТНОСИТЕЛЬНЫЙ base './', иначе ассеты дают 404 и React не стартует.
export default defineConfig(({ command }) => ({
  /* '@/domain/basal' читается сразу; '../../data/basal' требует держать в голове,
     где ты сейчас находишься, и переписывается пачками при переезде файлов. */
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  base: isCap ? './' : (command === 'build' ? '/SugarLife/v2/' : '/'),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
    /* Когда собран этот бандл. Нужен, чтобы отличить «релиз новее меня» от «релиз просто
       другой»: SHA умеет отвечать только «совпадает или нет», и по нему одинаково
       выглядят свежая сборка и позавчерашняя (SugarLife#238). */
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    __ИЗДАНИЕ__: JSON.stringify(издание),
  },
  plugins: [
    react(),
    /* ПАСПОРТ ВСТРОЕННОГО БАНДЛА (#569).

       Кабельная установка кладёт свежий веб-слой внутрь приложения, но поверх него лежит бандл,
       приехавший по воздуху, и показывается он. То есть провод менял натив и не менял ни одного
       экрана — ровно это владелец и увидел: «оформление никуда не переехало».

       Разорвать этот круг из JS нельзя: под OTA-бандлом код видит СВОИ `__APP_BUILD__` и
       `__APP_BUILT_AT__`, а не встроенные. Нужен файл рядом с ассетами, который натив прочтёт из
       своего бандла и сравнит даты за нас. */
    {
      name: 'паспорт-встроенного-бандла',
      generateBundle(_опции: unknown, _пакет: unknown) {
        (this as unknown as { emitFile: (f: unknown) => void }).emitFile({
          type: 'asset',
          fileName: 'build.json',
          source: JSON.stringify({ build, builtAt: new Date().toISOString() }),
        });
      },
    },
    // Service worker: кэш оболочки → мгновенный старт из фона + офлайн + авто-обновление.
    // В нативной сборке SW не нужен (ассеты локальные) — отключаем.
    VitePWA({
      disable: isCap,
      // 'prompt', а не 'autoUpdate': мы показываем состояние и спрашиваем разрешение.
      // При autoUpdate воркер подменял бы версию сам, и кнопка «Обновить» врала бы.
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: false, // используем свой public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // основной бандл подрос за 2 MiB — поднимаем лимит прекэша
      },
    }),
  ],
}))
