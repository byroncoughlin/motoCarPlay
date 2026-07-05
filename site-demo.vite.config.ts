// Standalone browser build of the site demo (no electron plugin): the real
// sensor overlay on a simulated ride, deployed to
// byronthegreat.com/projects/motocarplay/. Build with:
//   npx vite build --config site-demo.vite.config.ts
import path, { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@worker': path.resolve(__dirname, 'src/renderer/src/components/worker'),
      '@store': path.resolve(__dirname, 'src/renderer/src/store'),
      '@utils': path.resolve(__dirname, 'src/renderer/src/utils'),
      '@shared': path.resolve(__dirname, 'src/main/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-site-demo'),
    emptyOutDir: true,
    rolldownOptions: {
      input: resolve(__dirname, 'src/renderer/demo.html')
    }
  }
})
