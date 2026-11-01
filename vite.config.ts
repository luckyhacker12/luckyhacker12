import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API dev server runs on 8787 (see server/index.mjs); Vite proxies /api to it
// so the browser always talks to a single origin, exactly like production.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
