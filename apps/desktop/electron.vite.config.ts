import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        // Repository-root brand assets. The mark has one source of truth, so
        // the app imports it instead of restating its geometry and colors.
        '@assets': resolve(__dirname, '../../assets')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
