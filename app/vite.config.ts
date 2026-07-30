import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// В проде на GitHub Pages приложение живёт по пути /SugarLife/v2/.
// Для нативной сборки (Capacitor, CAP=1) файлы лежат в корне capacitor://localhost/
// → нужен ОТНОСИТЕЛЬНЫЙ base './', иначе ассеты дают 404 и React не стартует.
export default defineConfig(({ command }) => ({
  base: process.env.CAP === '1' ? './' : (command === 'build' ? '/SugarLife/v2/' : '/'),
  plugins: [react()],
}))
