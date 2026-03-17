import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// API target: honour VITE_API_URL env var, fall back to localhost:3000
// Using process.env here (Node.js side of Vite config) so it works for both
// `vite dev` and `vitest`.  In .env files prefix the key with VITE_ so
// client-side code can also read it via import.meta.env.VITE_API_URL.
const apiTarget = process.env.VITE_API_URL ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
