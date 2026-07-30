import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      // Two pages, not one: the editor, and the offscreen surface the export
      // screenshots its captions from. They share every module that matters —
      // that sharing is what makes a burned caption equal the preview.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          caption: resolve(__dirname, 'src/renderer/caption.html')
        }
      }
    },
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
