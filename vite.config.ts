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
        if (route !== 'health' && route !== 'process') return next()
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 2 * 1024 * 1024 + 1) break
          chunks.push(chunk as Buffer)
        }
        const mod = await server.ssrLoadModule('/api/_lib/handlers.ts')
        const request = { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
        const out = route === 'health' ? mod.handleHealth(request) : mod.handleProcess(request)
        res.statusCode = out.status
        for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, String(v))
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
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'FollowThru',
        short_name: 'FollowThru',
        description: "Chase what's late. Never what's done.",
        theme_color: '#07060D',
        background_color: '#07060D',
        display: 'standalone',
        start_url: '/dashboard',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,json}'],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})
