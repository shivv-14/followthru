import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Serves the Vercel functions in api/ during `npm run dev`, using the same handlers.
function apiDevServer(): Plugin {
  return {
    name: 'followthru-api-dev',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const route = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        const handlers = { health: 'handleHealth', process: 'handleProcess', evidence: 'handleEvidence' } as const
        if (!(route in handlers)) return next()
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 2 * 1024 * 1024 + 1) break
          chunks.push(chunk as Buffer)
        }
        const mod = await server.ssrLoadModule('/api/_lib/handlers.ts')
        const request = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
        const out = mod.withCors(request, (r: unknown) => mod[handlers[route as keyof typeof handlers]](r))
        res.statusCode = out.status
        for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, String(v))
        if (out.status === 204) return res.end()
        if (typeof out.body === 'string') return res.end(out.body)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(out.body))
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    apiDevServer(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'FollowThru - Chaser Draft Queue',
        short_name: 'FollowThru',
        description: "Chase what's late. Never what's done. A review queue that drafts reminders only for overdue, still-open commitments.",
        theme_color: '#07060D',
        background_color: '#07060D',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/dashboard',
        categories: ['productivity', 'business'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Queue', url: '/queue', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Dashboard', url: '/dashboard', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'My tasks', url: '/team', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
        screenshots: [
          { src: 'screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: 'Dashboard with demo data' },
          { src: 'screenshots/narrow.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Draft queue on a phone' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [{ urlPattern: /\/api\/.*$/, method: 'GET', handler: 'NetworkFirst', options: { cacheName: 'api-get' } }],
      },
    }),
  ],
})
