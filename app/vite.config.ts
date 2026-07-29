import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// В проде приложение живёт на GitHub Pages по пути /SugarLife/v2/
// (текущая ваниль-версия пока остаётся на /SugarLife/app/).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/SugarLife/v2/' : '/',
  plugins: [react()],
}))
