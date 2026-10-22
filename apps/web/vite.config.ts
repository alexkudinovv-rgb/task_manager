import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site from /<repo>/, so CI passes BASE_PATH (and VITE_DEMO=1 for mock data).
const base = process.env.BASE_PATH ?? '/'

// Company icons (npm run icons) stay out of git; the demo and fresh clones use the placeholders in public/icons.
const brandIcons = process.env.VITE_DEMO !== '1' && existsSync(fileURLToPath(new URL('public/brand/icon-192.png', import.meta.url)))
const iconDir = brandIcons ? 'brand' : 'icons'
// Read by the service worker for notification icons.
process.env.VITE_ICON_DIR = iconDir

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: 'brand-icons-html',
      // Favicons and the apple-touch icon; brand/ holds every icon of icons/ except the push badge.
      transformIndexHtml: (html) => (brandIcons ? html.replaceAll('/icons/', '/brand/') : html),
    },
    VitePWA({
      // Own service worker (src/sw.ts): precache + offline workspace + web push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // An update waits for «Обновить» (src/pwa/UpdatePrompt): a silent reload could eat a half-typed task.
      registerType: 'prompt',
      // Registered from bundled code (src/pwa/register.ts); the server's CSP forbids inline scripts.
      injectRegister: false,
      manifest: {
        id: base,
        name: 'Car City · Задачи',
        short_name: 'Задачи',
        description: 'Задачи Car City',
        lang: 'ru',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        theme_color: '#17181B',
        background_color: '#F1F2F4',
        // Relative to the manifest, so they work under any base.
        icons: [
          { src: `${iconDir}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${iconDir}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${iconDir}/maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${iconDir}/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: `${iconDir}/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      // The glob already takes the icons; the plugin adds manifest.webmanifest itself.
      includeManifestIcons: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
      // `PWA_DEV=1 npm run dev` runs the service worker in dev too (push tests against the local server).
      devOptions: {
        enabled: process.env.PWA_DEV === '1',
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    // `npm run dev` + `npm run dev:server`: one origin, so the session cookie just works. ws: /api/ws.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
})
