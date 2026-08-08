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
  base: isCap ? './' : (command === 'build' ? '/SugarLife/v2/' : '/'),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [
    react(),
    // Service worker: кэш оболочки → мгновенный старт из фона + офлайн + авто-обновление.
    // В нативной сборке SW не нужен (ассеты локальные) — отключаем.
    VitePWA({
      disable: isCap,
      registerType: 'autoUpdate',
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
