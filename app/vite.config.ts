import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const isCap = process.env.CAP === '1' // нативная сборка (Capacitor)

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
  },
  plugins: [
    react(),
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
