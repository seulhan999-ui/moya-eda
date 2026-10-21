import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// На GitHub Pages приложение живёт по адресу https://seulhan999-ui.github.io/moya-eda/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/moya-eda/' : '/',
  plugins: [react()],
}))
