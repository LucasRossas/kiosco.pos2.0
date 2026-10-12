import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
// firebase-admin hoists @firebase/app 0.16 / @firebase/component 0.7.
// The client SDK (firebase 11) nests 0.13 / 0.6. Auth then registers on a
// different component container than initializeApp, which throws
// "Component auth has not been registered yet" in the production bundle.
// https://vite.dev/config/
export default defineConfig({
  resolve: {
    dedupe: ['firebase', '@firebase/app', '@firebase/auth', '@firebase/component', '@firebase/firestore', '@firebase/util'],
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/analytics']
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Punto Mercado POS',
        short_name: 'Punto Mercado',
        description: 'Punto de venta y gestión para comercios.',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/world\.openfoodfacts\.org\/.*$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-food-facts-api',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
})
