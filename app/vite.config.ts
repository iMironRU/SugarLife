import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const isCap = process.env.CAP === '1' // нативная сборка (Capacitor)

// В проде на GitHub Pages приложение живёт по пути /SugarLife/v2/.
// Для нативной сборки (Capacitor, CAP=1) файлы лежат в корне capacitor://localhost/
// → нужен ОТНОСИТЕЛЬНЫЙ base './', иначе ассеты дают 404 и React не стартует.
export default defineConfig(({ command }) => ({
  base: isCap ? './' : (command === 'build' ? '/SugarLife/v2/' : '/'),
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
      },
    }),
  ],
}))
