import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /<repo>/, so CI passes BASE_PATH (and VITE_DEMO=1 for mock data).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    // `npm run dev` + `npm run dev:server`: one origin, so the session cookie just works.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
